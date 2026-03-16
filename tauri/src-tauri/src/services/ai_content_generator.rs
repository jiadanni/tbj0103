//! AI content generator (local heuristics tier).
//! Provides tag extraction, summarisation, and study-question generation
//! without requiring an Ollama call — fast, offline-capable.
//! Richer Ollama-powered versions are invoked from the frontend via the ollama commands.

use std::collections::HashMap;
use regex::Regex;
use std::sync::OnceLock;

static WORD_RE: OnceLock<Regex> = OnceLock::new();
fn word_re() -> &'static Regex {
    WORD_RE.get_or_init(|| Regex::new(r"\b[a-z][a-z0-9-]{2,}\b").unwrap())
}

/// Extract up to `max` keyword tags from `text` using term-frequency heuristics.
pub fn generate_tags(text: &str, max: usize) -> Vec<String> {
    const STOPWORDS: &[&str] = &[
        "the","a","an","and","or","but","in","on","at","to","for","of","with","by",
        "from","is","was","are","were","be","been","being","have","has","had",
        "do","does","did","will","would","could","should","may","might","can",
        "not","no","nor","so","yet","each","every","all","any","some","this",
        "that","these","those","than","too","very","just","also","also","then",
        "now","its","their","our","your","his","her","they","them","there",
    ];
    let lower = text.to_lowercase();
    let stopset: std::collections::HashSet<&str> = STOPWORDS.iter().copied().collect();
    let mut freq: HashMap<String, usize> = HashMap::new();
    for m in word_re().find_iter(&lower) {
        let w = m.as_str();
        if !stopset.contains(w) {
            *freq.entry(w.to_string()).or_default() += 1;
        }
    }
    let mut pairs: Vec<(String, usize)> = freq.into_iter().collect();
    pairs.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    pairs.into_iter().take(max).map(|(w, _)| w).collect()
}

/// Produce a short summary: first complete sentence, up to `max_chars`.
pub fn generate_summary(text: &str, max_chars: usize) -> String {
    let clean: String = text.chars().filter(|c| *c != '\r').collect();
    let first = clean.split("\n\n").find(|p| !p.trim().is_empty()).unwrap_or("");
    let summary: String = first.chars().take(max_chars).collect();
    if summary.len() < first.len() {
        format!("{}…", summary.trim_end())
    } else {
        summary
    }
}

/// Generate simple study questions from section headings in `text`.
pub fn generate_study_questions(text: &str) -> Vec<String> {
    let heading_re = Regex::new(r"(?m)^#{1,3}\s+(.+)$").unwrap();
    heading_re
        .captures_iter(text)
        .filter_map(|cap| cap.get(1).map(|m| m.as_str().trim().to_string()))
        .map(|heading| format!("What do you know about {}?", heading))
        .take(10)
        .collect()
}
