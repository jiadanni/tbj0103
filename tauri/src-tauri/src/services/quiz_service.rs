use crate::ollama::client::{OllamaClient, OllamaMessage};
use serde::Deserialize;

/// One AI-generated question with the answer key the grader will use.
#[derive(Debug, Clone, Deserialize)]
pub struct GeneratedQuestion {
    pub prompt: String,
    #[serde(default)]
    pub expected_answer: String,
    #[serde(default)]
    pub rubric: String,
    #[serde(default)]
    pub topic: String,
}

/// AI grade for a single typed answer.
#[derive(Debug, Clone, Deserialize)]
pub struct GradedAnswer {
    pub score: f64,
    pub feedback: String,
}

fn extract_json_array(raw: &str) -> Result<&str, String> {
    let start = raw
        .find('[')
        .ok_or_else(|| "AI response did not contain a JSON array".to_string())?;
    let end = raw
        .rfind(']')
        .ok_or_else(|| "AI response did not contain a closing ']'".to_string())?;
    if end <= start {
        return Err("AI response had malformed JSON array bounds".into());
    }
    Ok(&raw[start..=end])
}

fn extract_json_object(raw: &str) -> Result<&str, String> {
    let start = raw
        .find('{')
        .ok_or_else(|| "AI response did not contain a JSON object".to_string())?;
    let end = raw
        .rfind('}')
        .ok_or_else(|| "AI response did not contain a closing '}'".to_string())?;
    if end <= start {
        return Err("AI response had malformed JSON object bounds".into());
    }
    Ok(&raw[start..=end])
}

/// Generate `count` open-ended questions covering the given topics.
pub async fn generate_questions(
    ollama_url: Option<String>,
    model: &str,
    kind: &str,
    topics: &[String],
    count: usize,
) -> Result<Vec<GeneratedQuestion>, String> {
    if topics.is_empty() {
        return Err("No topics provided for quiz generation".into());
    }
    let topic_list = topics
        .iter()
        .map(|t| format!("- {t}"))
        .collect::<Vec<_>>()
        .join("\n");

    let style = if kind == "exam" {
        "Mix of recall, application, and synthesis questions. Some should require multi-sentence answers."
    } else {
        "Short, focused recall and understanding checks. One or two sentence answers."
    };

    let prompt = format!(
        "Generate exactly {count} open-ended quiz questions covering these topics:\n{topic_list}\n\n\
        Style: {style}\n\n\
        Each question must be answerable by typing a short free-text answer. \
        Do NOT generate multiple-choice or true/false. \
        For each question, also provide the model answer (\"expected_answer\") and a brief grading rubric (\"rubric\").\n\n\
        Output ONLY a JSON array. Each element must have keys: \"prompt\", \"expected_answer\", \"rubric\", \"topic\".\n\
        No markdown, no code fences, no commentary."
    );

    let client = OllamaClient::new(ollama_url)?;
    let messages = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];
    let raw = client.send_message("quiz", model, messages).await?;
    let json_str = extract_json_array(raw.trim())?;
    let questions: Vec<GeneratedQuestion> = serde_json::from_str(json_str)
        .map_err(|e| format!("Failed to parse generated questions: {e}\nRaw: {json_str}"))?;
    let filtered = questions
        .into_iter()
        .filter(|q| !q.prompt.trim().is_empty())
        .collect::<Vec<_>>();
    if filtered.is_empty() {
        return Err("AI returned no usable questions".into());
    }
    Ok(filtered)
}

/// Ask the AI to grade a single typed answer against the expected answer + rubric.
pub async fn grade_answer(
    ollama_url: Option<String>,
    model: &str,
    prompt: &str,
    expected_answer: &str,
    rubric: &str,
    user_answer: &str,
) -> Result<GradedAnswer, String> {
    let grading_prompt = format!(
        "You are grading a typed quiz answer.\n\n\
        Question:\n{prompt}\n\n\
        Model answer:\n{expected_answer}\n\n\
        Rubric:\n{rubric}\n\n\
        Student answer:\n{user_answer}\n\n\
        Score the student answer from 0.0 (entirely wrong or blank) to 1.0 (fully correct). \
        Partial credit is encouraged. Then write 1-3 sentences of feedback the student can learn from — \
        be specific about what was right, what was missing, and what to revisit.\n\n\
        Output ONLY a JSON object with keys \"score\" (number) and \"feedback\" (string). \
        No markdown, no code fences."
    );

    let client = OllamaClient::new(ollama_url)?;
    let messages = vec![OllamaMessage {
        role: "user".to_string(),
        content: grading_prompt,
    }];
    let raw = client.send_message("quiz_grade", model, messages).await?;
    let json_str = extract_json_object(raw.trim())?;
    let mut graded: GradedAnswer = serde_json::from_str(json_str)
        .map_err(|e| format!("Failed to parse AI grade: {e}\nRaw: {json_str}"))?;
    graded.score = graded.score.clamp(0.0, 1.0);
    Ok(graded)
}
