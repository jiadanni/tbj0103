use crate::db::DbState;
use tauri::State;

/// Demo mode: seeds temporary workspaces with sample data.
/// Each workspace showcases a different subject area with rich content.
/// All demo data uses hardcoded IDs so it can be cleanly removed on deactivate.
const DEMO_WS_AI: &str = "demo-workspace-ai-ml-000000000000000";
const DEMO_WS_MUSIC: &str = "demo-workspace-music-theory-0000000";
const DEMO_WS_ROME: &str = "demo-workspace-rome-000000000000000";

const DEMO_WORKSPACE_IDS: [&str; 3] = [DEMO_WS_AI, DEMO_WS_MUSIC, DEMO_WS_ROME];

const DEMO_PROJECT_AI: &str = "demo-project-transformers-000000000000";
const DEMO_PROJECT_AI_LLMS: &str = "demo-project-ai-llms-00000000000000";
const DEMO_PROJECT_MUSIC_HARMONY: &str = "demo-project-music-harmony-000000000";
const DEMO_PROJECT_MUSIC_RHYTHM: &str = "demo-project-music-rhythm-0000000000";
const DEMO_PROJECT_ROME: &str = "demo-project-rome-0000000000000000000";
const DEMO_PROJECT_ROME_MILITARY: &str = "demo-project-rome-military-00000000000";

const DEMO_SOURCE_AI_TRANSFORMER: &str = "demo-source-ai-transformer-0000000001";
const DEMO_SOURCE_MUSIC_CHORDS: &str = "demo-source-music-chords-0000000001";
const DEMO_SOURCE_ROME_RES_GESTAE: &str = "demo-source-rome-res-gestae-0000001";

const DEMO_MEMORY_AI_PREF: &str = "demo-memory-ai-preference-0000000001";
const DEMO_MEMORY_MUSIC_FACT: &str = "demo-memory-music-fact-000000000001";
const DEMO_MEMORY_ROME_PREF: &str = "demo-memory-rome-preference-00000001";

const DEMO_ARTIFACT_AI_ATTENTION: &str = "demo-artifact-ai-attention-code-001";

const DEMO_GOAL_AI_TRANSFORMER: &str = "demo-goal-ai-master-transformers-00001";
const DEMO_NOTE_AI_MATH: &str = "demo-note-ai-attention-math-000000001";

const DEMO_SOURCE_MUSIC_WEB: &str = "demo-source-music-web-theory-0000001";

const DEMO_GOAL_ROME_PUNIC: &str = "demo-goal-rome-punic-wars-00000000001";
const DEMO_NOTE_ROME_LEGATE: &str = "demo-note-rome-legate-duties-000000001";

#[tauri::command]
pub fn activate_demo_mode(state: State<DbState>) -> Result<String, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();

    // Remove any previous demo data
    for ws_id in DEMO_WORKSPACE_IDS {
        let _ = conn.execute("DELETE FROM workspaces WHERE id = ?1", rusqlite::params![ws_id]);
    }

    // ── Workspace 1: AI & Machine Learning ──────────────────────────────
    conn.execute(
        "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?1, '🧠 AI & Machine Learning', ?2, ?3)",
        rusqlite::params![DEMO_WS_AI, now, now],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO projects (id, workspace_id, name, project_description, color, icon, created_at, updated_at) VALUES (?1, ?2, 'Transformer Architecture', 'Deep dive into attention mechanisms and transformer models', '#007AFF', 'brain', ?3, ?4)",
        rusqlite::params![DEMO_PROJECT_AI, DEMO_WS_AI, now, now],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO projects (id, workspace_id, name, project_description, color, icon, created_at, updated_at) VALUES (?1, ?2, 'Large Language Models', 'Practical applications and fine-tuning of LLMs', '#5AC8FA', 'rectangle.stack.fill', ?3, ?4)",
        rusqlite::params![DEMO_PROJECT_AI_LLMS, DEMO_WS_AI, now, now],
    ).map_err(|e| e.to_string())?;

    // Chat: self-attention
    let session_ai_1 = "demo-chat-session-transformers-00001";
    conn.execute(
        "INSERT INTO chat_sessions (id, workspace_id, project_id, title, model_name, created_at, updated_at) VALUES (?1, ?2, ?3, 'What is Self-Attention?', '', ?4, ?5)",
        rusqlite::params![session_ai_1, DEMO_WS_AI, DEMO_PROJECT_AI, now, now],
    ).map_err(|e| e.to_string())?;

    let ai_msgs_1: Vec<(&str, &str)> = vec![
        ("user", "Can you explain how self-attention works in transformers?"),
        ("assistant", "Self-attention allows each token in a sequence to attend to every other token, computing relevance scores (called attention weights).\n\nFor each token, we compute three vectors: **Query (Q)**, **Key (K)**, and **Value (V)**. The attention score between token i and token j is computed as:\n\n```\nAttention(Q,K,V) = softmax(QK^T / √d_k) × V\n```\n\nThe scaling factor `√d_k` prevents vanishing gradients. This mechanism captures long-range dependencies that RNNs struggled with. See [[Attention Mechanism]] and [[Query Key Value]] for more depth."),
        ("user", "How does multi-head attention differ?"),
        ("assistant", "[[Multi-Head Attention]] runs multiple attention operations in parallel — typically 8 or 16 heads — each with different learned projections. Each head can specialize in different aspects of the sequence.\n\nThe outputs of all heads are concatenated:\n\n```\nMultiHead(Q,K,V) = Concat(head₁,...,headₕ)W^O\n```\n\nThis dramatically increases representational power without proportionally multiplying compute."),
    ];
    for (role, content) in &ai_msgs_1 {
        let mid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![mid, session_ai_1, role, content, now],
        ).map_err(|e| e.to_string())?;
    }

    // Chat: scaling laws
    let session_ai_2 = "demo-chat-session-ai-scaling-00001";
    conn.execute(
        "INSERT INTO chat_sessions (id, workspace_id, project_id, title, model_name, created_at, updated_at) VALUES (?1, ?2, ?3, 'Scaling Laws and Emergent Abilities', '', ?4, ?5)",
        rusqlite::params![session_ai_2, DEMO_WS_AI, DEMO_PROJECT_AI_LLMS, now, now],
    ).map_err(|e| e.to_string())?;

    let ai_msgs_2: Vec<(&str, &str)> = vec![
        ("user", "What are scaling laws in deep learning?"),
        ("assistant", "[[Scaling Laws]] describe how model performance improves predictably as we increase model size, data size, and compute. Key findings:\n\n1. **Power-law relationships** — Performance ∝ N^(-α) where N is parameters/data and α ≈ 0.07-0.1\n2. **Compute-optimal** — For fixed compute budget, optimal model size is ~20x smaller than data tokens\n3. **Transfer enabled** — Large models display [[Emergent Abilities]] — tasks solvable at scale that fail at small scale"),
        ("user", "Give examples of emergent abilities."),
        ("assistant", "[[Emergent Abilities]] are capabilities that only appear above certain model scales:\n\n- **In-context learning** — Models can learn from examples in context without parameter updates\n- **Chain-of-thought reasoning** — Solving multi-step problems by working through intermediate steps\n- **Instruction following** — Understanding and executing diverse instructions without task-specific training\n- **Few-shot generalization** — Solving novel problems with just 1-2 examples\n\nThese abilities weren't explicitly designed; they emerge from scale and are hard to predict beforehand."),
    ];
    for (role, content) in &ai_msgs_2 {
        let mid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![mid, session_ai_2, role, content, now],
        ).map_err(|e| e.to_string())?;
    }

    // Concepts for AI workspace — expanded
    let ai_concepts: Vec<(&str, &str, &str, &str)> = vec![
        ("demo-concept-attention-0000000000001", "Attention Mechanism", "Core mechanism computing weighted relevance between sequence elements.", "technology"),
        ("demo-concept-transformer-000000000001", "Transformer", "Architecture based entirely on attention mechanisms, without recurrence.", "technology"),
        ("demo-concept-qkv-00000000000000000001", "Query Key Value", "Three matrices used in attention: Q (what to find), K (what to match), V (what to retrieve).", "definition"),
        ("demo-concept-mlh-00000000000000000001", "Multi-Head Attention", "Parallel attention operations with different learned projections.", "technology"),
        ("demo-concept-scaling-laws-000000000001", "Scaling Laws", "Predictable performance improvements with increased model/data size following power laws.", "resource"),
        ("demo-concept-emergent-abilities-001", "Emergent Abilities", "Capabilities appearing only above certain model scales: in-context learning, chain-of-thought, instruction following.", "insight"),
        ("demo-concept-llm-finetuning-0000001", "LLM Fine-tuning", "Adapting pre-trained models to specific tasks via continued training on domain data.", "definition"),
        ("demo-concept-tokenization-00000000001", "Tokenization", "Breaking text into tokens (words/subwords) as the input unit for transformers.", "definition"),
    ];
    for (id, name, desc, ctype) in &ai_concepts {
        conn.execute(
            "INSERT OR IGNORE INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, '[]', '[]', '[]', 0, 0, 0, ?6, ?7)",
            rusqlite::params![id, DEMO_WS_AI, name, desc, ctype, now, now],
        ).map_err(|e| e.to_string())?;
    }

    let ai_links: Vec<(&str, &str, &str)> = vec![
        ("demo-concept-attention-0000000000001", "demo-concept-transformer-000000000001", "supports"),
        ("demo-concept-qkv-00000000000000000001", "demo-concept-attention-0000000000001", "part_of"),
        ("demo-concept-mlh-00000000000000000001", "demo-concept-attention-0000000000001", "related"),
        ("demo-concept-scaling-laws-000000000001", "demo-concept-transformer-000000000001", "supports"),
        ("demo-concept-emergent-abilities-001", "demo-concept-scaling-laws-000000000001", "example"),
        ("demo-concept-llm-finetuning-0000001", "demo-concept-transformer-000000000001", "supports"),
        ("demo-concept-tokenization-00000000001", "demo-concept-llm-finetuning-0000001", "prerequisite"),
    ];
    for (src, tgt, ltype) in &ai_links {
        let lid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT OR IGNORE INTO concept_links (id, source_id, target_id, link_type, strength, context, created_at) VALUES (?1, ?2, ?3, ?4, 0.8, '', ?5)",
            rusqlite::params![lid, src, tgt, ltype, now],
        ).map_err(|e| e.to_string())?;
    }

    // Flashcards for AI workspace — expanded
    let ai_cards: Vec<(&str, &str)> = vec![
        ("What does Q, K, V stand for in attention?", "Query, Key, Value — Q asks 'what to look for', K advertises 'what I am', V states 'what I contain'."),
        ("What is the scaling factor in attention and why?", "√d_k — prevents dot products from growing too large in high dimensions, keeping softmax gradients stable."),
        ("What are scaling laws?", "Empirical observation that performance improves predictably as N^(-α) where N is model/data size and α ≈ 0.07-0.1."),
        ("Name three emergent abilities in LLMs.", "In-context learning, chain-of-thought reasoning, instruction following. These appear only above certain scales."),
        ("What is the compute-optimal model size?", "For fixed compute, optimal model size is ~20x smaller than data tokens. Violates early intuitions about model vs data trade-offs."),
        ("What is tokenization?", "Process of breaking text into atomic units (tokens) that transformers process. Can be characters, words, or subwords."),
        ("Explain multi-head attention.", "Running N parallel attention heads with different projections, then concatenating. Each head specializes in different patterns."),
        ("What is fine-tuning?", "Continuing training of a pre-trained model on domain-specific data with low learning rates to adapt to new tasks."),
    ];
    for (front, back) in &ai_cards {
        let cid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO learning_cards (id, workspace_id, front, back, source_type, ease_factor, interval, repetitions, next_review_date, created_at) VALUES (?1, ?2, ?3, ?4, 'ai_generated', 2.5, 1, 0, ?5, ?6)",
            rusqlite::params![cid, DEMO_WS_AI, front, back, today, now],
        ).map_err(|e| e.to_string())?;
    }

    // Daily notes for AI workspace (past 7 days)
    for days_ago in 0..7i64 {
        let date = (chrono::Utc::now() - chrono::Duration::days(days_ago)).format("%Y-%m-%d").to_string();
        let dnid = uuid::Uuid::new_v4().to_string();
        let content = if days_ago == 0 {
            format!("## Daily Note — {date}\n\nFinished scaling laws reading. The compute-optimal tradeoffs are counterintuitive.\n\n- Read Chinchilla paper on compute allocation\n- Explored emergent abilities across model sizes\n- Connected scaling laws to fine-tuning strategy")
        } else if days_ago == 1 {
            format!("## Daily Note — {date}\n\nDeep dive into transformer architectures. Multi-head attention finally makes sense.\n\n- Traced through self-attention math step-by-step\n- Compared RNN vs Transformer on long sequences\n- Created concept links from QKV → Attention → Transformer")
        } else {
            format!("## Daily Note — {date}\n\nReviewed fundamental concepts and practiced flashcards.\n\n- Drilled transformer basics\n- Reviewed tokenization and embeddings\n- Updated concept graph with new insights")
        };
        conn.execute(
            "INSERT OR IGNORE INTO daily_notes (id, workspace_id, date, content, mood, productivity, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 8, 8, ?5, ?6)",
            rusqlite::params![dnid, DEMO_WS_AI, date, content, now, now],
        ).map_err(|e| e.to_string())?;
    }

    // AI Workspace: Source Document
    conn.execute(
        "INSERT INTO sources (id, workspace_id, source_type, title, filename, file_type, content, is_processed, created_at, updated_at)
         VALUES (?1, ?2, 'document', 'Attention Is All You Need - Summary', 'transformer_summary.md', 'markdown', ?3, 1, ?4, ?5)",
        rusqlite::params![
            DEMO_SOURCE_AI_TRANSFORMER,
            DEMO_WS_AI,
            "The Transformer model relies entirely on an attention mechanism to draw global dependencies between input and output. The model architecture uses stacked self-attention and point-wise, fully connected layers for both the encoder and decoder.

Key highlights:
1. Encoder and Decoder Stacks: Both use multi-head self-attention.
2. Attention: Maps a query and a set of key-value pairs to an output.
3. Multi-Head Attention: Allows the model to jointly attend to information from different representation subspaces at different positions.",
            now,
            now
        ],
    ).map_err(|e| e.to_string())?;

    // AI Workspace: Source Chunks
    let ai_chunks = vec![
        "The Transformer model relies entirely on an attention mechanism to draw global dependencies between input and output.",
        "Key highlights: 1. Encoder and Decoder Stacks: Both use multi-head self-attention.",
        "3. Multi-Head Attention: Allows the model to jointly attend to information from different representation subspaces at different positions."
    ];
    for (i, chunk) in ai_chunks.iter().enumerate() {
        let chunk_id = format!("{}-chunk-{}", DEMO_SOURCE_AI_TRANSFORMER, i);
        conn.execute(
            "INSERT INTO source_chunks (id, source_id, content, chunk_index, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![chunk_id, DEMO_SOURCE_AI_TRANSFORMER, chunk, i as i32, now],
        ).map_err(|e| e.to_string())?;
    }

    // AI Workspace: Memory
    conn.execute(
        "INSERT INTO memories (id, workspace_id, content, memory_type, scope, created_at, updated_at)
         VALUES (?1, ?2, 'Prefers detailed technical explanations with LaTeX math notation.', 'preference', 'workspace', ?3, ?4)",
        rusqlite::params![DEMO_MEMORY_AI_PREF, DEMO_WS_AI, now, now],
    ).map_err(|e| e.to_string())?;

    // AI Workspace: Artifact
    conn.execute(
        "INSERT INTO artifacts (id, workspace_id, session_id, title, artifact_type, language, content, description, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'Self-Attention Implementation', 'code', 'python', ?4, 'A simple PyTorch-like implementation of the self-attention mechanism.', ?5, ?6)",
        rusqlite::params![
            DEMO_ARTIFACT_AI_ATTENTION,
            DEMO_WS_AI,
            session_ai_1,
            "import torch
import torch.nn.functional as F

def self_attention(query, key, value, mask=None):
    d_k = query.size(-1)
    scores = torch.matmul(query, key.transpose(-2, -1)) /  math.sqrt(d_k)
    if mask is not None:
        scores = scores.masked_fill(mask == 0, -1e9)
    p_attn = F.softmax(scores, dim=-1)
    return torch.matmul(p_attn, value), p_attn",
            now,
            now
        ],
    ).map_err(|e| e.to_string())?;

    // AI Workspace: Learning Goal
    conn.execute(
        "INSERT INTO learning_goals (id, workspace_id, title, goal_description, progress, is_completed, due_date, prerequisite_ids, related_chat_ids, created_at, updated_at)
         VALUES (?1, ?2, 'Master Transformer Architecture', 'Deep understanding of self-attention, multi-head attention, and positional encoding.', 0.45, 0, ?3, '[]', ?4, ?5, ?6)",
        rusqlite::params![
            DEMO_GOAL_AI_TRANSFORMER,
            DEMO_WS_AI,
            (chrono::Utc::now() + chrono::Duration::days(14)).format("%Y-%m-%d").to_string(),
            format!("[\"{}\"]", session_ai_1),
            now,
            now
        ],
    ).map_err(|e| e.to_string())?;

    // AI Workspace: Project Note
    conn.execute(
        "INSERT INTO project_notes (id, workspace_id, title, content, note_type, tags, created_at, updated_at)
         VALUES (?1, ?2, 'Attention Mechanism Deep Dive', ?3, 'ai_generated', '[\"math\", \"deep-learning\"]', ?4, ?5)",
        rusqlite::params![
            DEMO_NOTE_AI_MATH,
            DEMO_WS_AI,
            "## Mathematical Intuition of Self-Attention

Self-attention can be viewed as a mapping from a query and a set of key-value pairs to an output. The output is a weighted sum of the values.

### The Scaling Factor
The reason for $\\sqrt{d_k}$ is to keep the dot products from growing too large in magnitude, which would push the softmax function into regions where it has extremely small gradients.

### Complexity
Compared to RNNs ($O(n \\cdot d^2)$), self-attention is $O(n^2 \\cdot d)$, making it faster for shorter sequences but memory-intensive for very long ones.",
            now,
            now
        ],
    ).map_err(|e| e.to_string())?;

    // ── Workspace 2: Music Theory ────────────────────────────────────
    conn.execute(
        "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?1, '🎵 Music Theory', ?2, ?3)",
        rusqlite::params![DEMO_WS_MUSIC, now, now],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO projects (id, workspace_id, name, project_description, color, icon, created_at, updated_at) VALUES (?1, ?2, 'Harmony & Chords', 'Understanding chord construction, inversions, and progressions', '#34C759', 'music.note.list', ?3, ?4)",
        rusqlite::params![DEMO_PROJECT_MUSIC_HARMONY, DEMO_WS_MUSIC, now, now],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO projects (id, workspace_id, name, project_description, color, icon, created_at, updated_at) VALUES (?1, ?2, 'Rhythm & Meter', 'Time signatures, subdivisions, and rhythmic patterns', '#AF52DE', 'metronome', ?3, ?4)",
        rusqlite::params![DEMO_PROJECT_MUSIC_RHYTHM, DEMO_WS_MUSIC, now, now],
    ).map_err(|e| e.to_string())?;

    // Chat: chord progressions
    let session_music_1 = "demo-chat-session-music-harmony-00001";
    conn.execute(
        "INSERT INTO chat_sessions (id, workspace_id, project_id, title, model_name, created_at, updated_at) VALUES (?1, ?2, ?3, 'How do chord progressions work?', '', ?4, ?5)",
        rusqlite::params![session_music_1, DEMO_WS_MUSIC, DEMO_PROJECT_MUSIC_HARMONY, now, now],
    ).map_err(|e| e.to_string())?;

    let music_msgs_1: Vec<(&str, &str)> = vec![
        ("user", "Can you explain how chord progressions work and why some sound more natural?"),
        ("assistant", "[[Chord Progressions]] are sequences built from [[Major Scale]] degrees. In C major:\n\n| Degree | Chord | Quality |\n|--------|-------|----------|\n| I | C | Major |\n| ii | Dm | minor |\n| iii | Em | minor |\n| IV | F | Major |\n| V | G | Major |\n| vi | Am | minor |\n| vii° | Bdim | diminished |\n\nProgressions sound natural following the **circle of fifths**: tension (V) resolves to rest (I). The most common is **I → V → vi → IV** (C → G → Am → F), found in hundreds of songs.\n\nThe [[Tritone]] between V and I creates satisfying tension/resolution."),
        ("user", "What makes minor keys different from major?"),
        ("assistant", "Key differences in [[Minor Scale]] vs major:\n\n- **Major scale:** W-W-H-W-W-W-H (bright, major 3rd)\n- **Minor scale:** W-H-W-W-H-W-W (dark, minor 3rd)\n\nThe **minor 3rd** transforms every chord. Minor keys also have variants:\n- **Harmonic minor** — raises 7th for strong V→i\n- **Melodic minor** — raises 6th & 7th ascending only\n\nComposers mix all three freely. [[Circle of Fifths]] shows every major key has a **relative minor** using same notes but different root."),
    ];
    for (role, content) in &music_msgs_1 {
        let mid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![mid, session_music_1, role, content, now],
        ).map_err(|e| e.to_string())?;
    }

    // Chat: rhythm and time
    let session_music_2 = "demo-chat-session-music-rhythm-00001";
    conn.execute(
        "INSERT INTO chat_sessions (id, workspace_id, project_id, title, model_name, created_at, updated_at) VALUES (?1, ?2, ?3, 'Understanding Time Signatures', '', ?4, ?5)",
        rusqlite::params![session_music_2, DEMO_WS_MUSIC, DEMO_PROJECT_MUSIC_RHYTHM, now, now],
    ).map_err(|e| e.to_string())?;

    let music_msgs_2: Vec<(&str, &str)> = vec![
        ("user", "What does 4/4 time signature mean?"),
        ("assistant", "In 4/4 ([[Time Signature]]):\n\n- **First number (4)** = 4 beats per measure\n- **Second number (4)** = quarter note gets the beat\n\n4/4 is \"common time\" — the most used signature in Western music. A measure has 4 quarter-note beats. At 120 BPM, each beat is 0.5 seconds.\n\nOther common signatures: 3/4 (waltz), 6/8 (compound duple), 7/8 (odd meter)."),
        ("user", "How are polyrhythms created?"),
        ("assistant", "[[Polyrhythms]] layer different rhythmic patterns simultaneously — creating tension and complexity:\n\n- **3 against 2** — 3 notes in one hand over 2 in the other\n- **4 against 3** — common in jazz and modern drums\n- **5 against 4** — creates shifting accents\n\n[[Syncopation]] emphasizes offbeats, creating \"swing\" feel. The brain naturally gravitates toward simpler ratios — 1:1 and 2:1 feel stable, while 3:2 feels unstable and interesting."),
    ];
    for (role, content) in &music_msgs_2 {
        let mid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![mid, session_music_2, role, content, now],
        ).map_err(|e| e.to_string())?;
    }

    // Concepts for Music Theory workspace — expanded
    let music_concepts: Vec<(&str, &str, &str, &str)> = vec![
        ("demo-concept-major-scale-0000000000001", "Major Scale", "Seven-note scale (W-W-H-W-W-W-H) foundational for chords, intervals, and keys.", "definition"),
        ("demo-concept-intervals-00000000000000001", "Intervals", "Distance between pitches in half-steps. Determine chord quality and melodic character.", "definition"),
        ("demo-concept-circle-fifths-000000000001", "Circle of Fifths", "Diagram showing relationships between 12 pitches and their key signatures.", "topic"),
        ("demo-concept-tritone-000000000000000001", "Tritone", "3 whole steps (6 half-steps) — drives dominant-to-tonic resolution.", "definition"),
        ("demo-concept-cadence-000000000000000001", "Cadence", "Chord progression signaling phrase end. Types: authentic (V-I), plagal (IV-I), deceptive (V-vi).", "definition"),
        ("demo-concept-time-signature-000000000001", "Time Signature", "Indicates beats per measure and which note gets the beat (e.g., 4/4, 3/4, 6/8).", "definition"),
        ("demo-concept-polyrhythm-00000000000001", "Polyrhythm", "Layering different rhythmic patterns creating tension: 3:2, 4:3, 5:4.", "resource"),
        ("demo-concept-syncopation-00000000000001", "Syncopation", "Emphasizing offbeats creating swing, jazz feel, and rhythmic interest.", "definition"),
        ("demo-concept-chord-progression-00000001", "Chord Progression", "Sequence of chords following circle of fifths: I→V→vi→IV most common.", "topic"),
    ];
    for (id, name, desc, ctype) in &music_concepts {
        conn.execute(
            "INSERT OR IGNORE INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, '[]', '[]', '[]', 0, 0, 0, ?6, ?7)",
            rusqlite::params![id, DEMO_WS_MUSIC, name, desc, ctype, now, now],
        ).map_err(|e| e.to_string())?;
    }

    let music_links: Vec<(&str, &str, &str)> = vec![
        ("demo-concept-intervals-00000000000000001", "demo-concept-major-scale-0000000000001", "part_of"),
        ("demo-concept-tritone-000000000000000001", "demo-concept-intervals-00000000000000001", "related"),
        ("demo-concept-circle-fifths-000000000001", "demo-concept-major-scale-0000000000001", "related"),
        ("demo-concept-cadence-000000000000000001", "demo-concept-tritone-000000000000000001", "related"),
        ("demo-concept-chord-progression-00000001", "demo-concept-circle-fifths-000000000001", "supports"),
        ("demo-concept-time-signature-000000000001", "demo-concept-polyrhythm-00000000000001", "prerequisite"),
        ("demo-concept-syncopation-00000000000001", "demo-concept-time-signature-000000000001", "supports"),
        ("demo-concept-polyrhythm-00000000000001", "demo-concept-syncopation-00000000000001", "related"),
    ];
    for (src, tgt, ltype) in &music_links {
        let lid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT OR IGNORE INTO concept_links (id, source_id, target_id, link_type, strength, context, created_at) VALUES (?1, ?2, ?3, ?4, 0.8, '', ?5)",
            rusqlite::params![lid, src, tgt, ltype, now],
        ).map_err(|e| e.to_string())?;
    }

    // Flashcards for Music Theory workspace — expanded
    let music_cards: Vec<(&str, &str)> = vec![
        ("What interval is a tritone?", "Three whole steps (6 half-steps) — e.g. C to F#. Divides octave exactly in half, drives V-I resolution."),
        ("What are chord qualities in a major key?", "I=Major, ii=minor, iii=minor, IV=Major, V=Major, vi=minor, vii°=diminished."),
        ("What is a perfect cadence?", "V → I (or V7 → I). Strongest resolution, signaling definitive phrase end."),
        ("What is the relative minor of C major?", "A minor — same white keys but starts on A, giving different tonal center."),
        ("What does 4/4 time signature mean?", "4 beats per measure, quarter note gets the beat. Most common signature in Western music."),
        ("Define polyrhythm.", "Layering different rhythmic patterns: 3:2, 4:3, etc. Creates tension through metric conflict."),
        ("What is syncopation?", "Emphasizing offbeats or unexpected rhythmic placement, creating swing and rhythmic interest."),
        ("What is the most common chord progression?", "I→V→vi→IV (C→G→Am→F). Appears in hundreds of pop songs because of its satisfying arc."),
    ];
    for (front, back) in &music_cards {
        let cid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO learning_cards (id, workspace_id, front, back, source_type, ease_factor, interval, repetitions, next_review_date, created_at) VALUES (?1, ?2, ?3, ?4, 'ai_generated', 2.5, 1, 0, ?5, ?6)",
            rusqlite::params![cid, DEMO_WS_MUSIC, front, back, today, now],
        ).map_err(|e| e.to_string())?;
    }

    // Daily notes for Music Theory workspace (past 7 days)
    for days_ago in 0..7i64 {
        let date = (chrono::Utc::now() - chrono::Duration::days(days_ago)).format("%Y-%m-%d").to_string();
        let dnid = uuid::Uuid::new_v4().to_string();
        let content = if days_ago == 0 {
            format!("## Daily Note — {date}\n\nPolyrhythms blew my mind today. 3:2 creates such interesting tension.\n\n- Analyzed drum patterns with polyrhythmic layers\n- Listened to progressive rock with unusual meters\n- Created concept links between syncopation and polyrhythm")
        } else if days_ago == 2 {
            format!("## Daily Note — {date}\n\nWorked through chord progressions in C major. I-V-vi-IV pattern finally clicked.\n\n- Analyzed 5 pop songs for their chord progressions\n- Reviewed flashcards on intervals and cadences\n- Added concept links between Tritone and Cadence")
        } else {
            format!("## Daily Note — {date}\n\nContinuing music theory journey. Practiced time signatures and rhythm exercises.\n\n- Drilled uncommon time signatures (5/4, 7/8)\n- Worked on transcription skills\n- Reviewed theory fundamentals")
        };
        conn.execute(
            "INSERT OR IGNORE INTO daily_notes (id, workspace_id, date, content, mood, productivity, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 8, 8, ?5, ?6)",
            rusqlite::params![dnid, DEMO_WS_MUSIC, date, content, now, now],
        ).map_err(|e| e.to_string())?;
    }

    // Music Workspace: Source Document
    conn.execute(
        "INSERT INTO sources (id, workspace_id, source_type, title, filename, file_type, content, is_processed, created_at, updated_at)
         VALUES (?1, ?2, 'document', 'Circle of Fifths Reference', 'circle_of_fifths.md', 'markdown', ?3, 1, ?4, ?5)",
        rusqlite::params![
            DEMO_SOURCE_MUSIC_CHORDS,
            DEMO_WS_MUSIC,
            "The Circle of Fifths is a visual representation of the relationships among the 12 tones of the chromatic scale, their corresponding key signatures, and the associated major and minor keys.

It is essential for:
- Understanding key signatures
- Transposing music
- Harmonizing melodies
- Understanding chord progressions (I-IV-V)",
            now,
            now
        ],
    ).map_err(|e| e.to_string())?;

    // Music Workspace: Source Chunks
    let music_chunks = vec![
        "The Circle of Fifths is a visual representation of the relationships among the 12 tones of the chromatic scale.",
        "It is essential for: Understanding key signatures, Transposing music, and Harmonizing melodies."
    ];
    for (i, chunk) in music_chunks.iter().enumerate() {
        let chunk_id = format!("{}-chunk-{}", DEMO_SOURCE_MUSIC_CHORDS, i);
        conn.execute(
            "INSERT INTO source_chunks (id, source_id, content, chunk_index, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![chunk_id, DEMO_SOURCE_MUSIC_CHORDS, chunk, i as i32, now],
        ).map_err(|e| e.to_string())?;
    }

    // Music Workspace: Memory
    conn.execute(
        "INSERT INTO memories (id, workspace_id, content, memory_type, scope, created_at, updated_at)
         VALUES (?1, ?2, 'The user is currently focusing on Jazz harmony and extended chords (9ths, 11ths, 13ths).', 'context', 'workspace', ?3, ?4)",
        rusqlite::params![DEMO_MEMORY_MUSIC_FACT, DEMO_WS_MUSIC, now, now],
    ).map_err(|e| e.to_string())?;

    // Music Workspace: Web Capture Source
    conn.execute(
        "INSERT INTO sources (id, workspace_id, source_type, title, url, content, is_processed, created_at, updated_at)
         VALUES (?1, ?2, 'web_capture', 'Modern Music Theory - Advanced Harmony', 'https://example.com/musictheory/advanced-harmony', ?3, 1, ?4, ?5)",
        rusqlite::params![
            DEMO_SOURCE_MUSIC_WEB,
            DEMO_WS_MUSIC,
            "Functional harmony in jazz often involves 'ii-V-I' progressions and their variations. This article explores how to substitute dominant chords with tritone substitutions to create chromatic bass movement.

Key topics:
- Tritone substitution
- Secondary dominants
- Altered scales and their use over V7 chords",
            now,
            now
        ],
    ).map_err(|e| e.to_string())?;

    // Music Workspace: Concepts (Continued)
    let more_music_concepts: Vec<(&str, &str, &str, &str)> = vec![
        ("demo-concept-jazz-harmony-000000001", "Jazz Harmony", "Complex harmonic structures characteristic of jazz music.", "topic"),
        ("demo-concept-ii-v-i-000000000000001", "ii-V-I Progression", "The most common chord progression in jazz and bebop.", "definition"),
    ];
    for (id, name, desc, ctype) in &more_music_concepts {
        conn.execute(
            "INSERT OR IGNORE INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, '[]', '[]', '[]', 0, 0, 0, ?6, ?7)",
            rusqlite::params![id, DEMO_WS_MUSIC, name, desc, ctype, now, now],
        ).map_err(|e| e.to_string())?;
    }

    conn.execute(
        "INSERT OR IGNORE INTO concept_links (id, source_id, target_id, link_type, strength, context, created_at) VALUES (?1, ?2, ?3, 'related', 0.9, '', ?4)",
        rusqlite::params![uuid::Uuid::new_v4().to_string(), "demo-concept-jazz-harmony-000000001", "demo-concept-chord-progression-00000001", now],
    ).map_err(|e| e.to_string())?;

    // ── Workspace 3: Roman History ──────────────────────────────────────
    conn.execute(
        "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?1, '🏛️ Roman History', ?2, ?3)",
        rusqlite::params![DEMO_WS_ROME, now, now],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO projects (id, workspace_id, name, project_description, color, icon, created_at, updated_at) VALUES (?1, ?2, 'Fall of the Republic', 'The transformation from Republic to Empire', '#FF9500', 'building.columns', ?3, ?4)",
        rusqlite::params![DEMO_PROJECT_ROME, DEMO_WS_ROME, now, now],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO projects (id, workspace_id, name, project_description, color, icon, created_at, updated_at) VALUES (?1, ?2, 'Roman Military', 'Legions, tactics, and military organization of Rome', '#FF3B30', 'shield.fill', ?3, ?4)",
        rusqlite::params![DEMO_PROJECT_ROME_MILITARY, DEMO_WS_ROME, now, now],
    ).map_err(|e| e.to_string())?;

    // Chat: Roman Republic fall
    let session_rome_1 = "demo-chat-session-rome-republic-00001";
    conn.execute(
        "INSERT INTO chat_sessions (id, workspace_id, project_id, title, model_name, created_at, updated_at) VALUES (?1, ?2, ?3, 'Fall of the Roman Republic', '', ?4, ?5)",
        rusqlite::params![session_rome_1, DEMO_WS_ROME, DEMO_PROJECT_ROME, now, now],
    ).map_err(|e| e.to_string())?;

    let rome_msgs_1: Vec<(&str, &str)> = vec![
        ("user", "What caused the fall of the Roman Republic?"),
        ("assistant", "The fall was gradual, driven by interconnected crises:\n\n1. **Land reform conflicts** — [[Gracchi brothers]] (133–121 BC) exposed class tensions\n2. **Military loyalty shift** — After [[Marius]]'s reforms, soldiers became loyal to generals, not the state\n3. **Civil wars** — [[Sulla]]'s march on Rome (88 BC) set precedent for military force in politics\n4. **First Triumvirate** — [[Julius Caesar]], Pompey, Crassus undermined Senate authority\n5. **Dictatorship** — Caesar's concentration of power led to assassination (44 BC)\n6. **Collapse** — Second Triumvirate and Octavian's victory at Actium (31 BC) ended the Republic\n\nIt was death by a thousand cuts over ~100 years."),
        ("user", "How did Caesar's assassination accelerate the end?"),
        ("assistant", "Ironically, the Liberatores thought killing Caesar would restore the Republic:\n\n- **Power vacuum** — Led to chaos, not freedom. Senate couldn't reassert control\n- **Public outrage** — Antony's funeral speech turned opinion against assassins\n- **[[Octavian]]'s rise** — Caesar's 18-year-old heir was brilliant. Used Caesar's name, wealth, veterans to build power\n- **More civil wars** — Next 13 years: Octavian vs Antony vs assassins\n- **Permanent autocracy** — Octavian (Augustus) kept republican forms while holding absolute power\n\nThe assassination proved the Republic's institutions were too hollowed to function without a strongman."),
    ];
    for (role, content) in &rome_msgs_1 {
        let mid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![mid, session_rome_1, role, content, now],
        ).map_err(|e| e.to_string())?;
    }

    // Chat: Roman military
    let session_rome_2 = "demo-chat-session-rome-military-00001";
    conn.execute(
        "INSERT INTO chat_sessions (id, workspace_id, project_id, title, model_name, created_at, updated_at) VALUES (?1, ?2, ?3, 'Roman Legions and Military Organization', '', ?4, ?5)",
        rusqlite::params![session_rome_2, DEMO_WS_ROME, DEMO_PROJECT_ROME_MILITARY, now, now],
    ).map_err(|e| e.to_string())?;

    let rome_msgs_2: Vec<(&str, &str)> = vec![
        ("user", "What was the structure of a Roman legion?"),
        ("assistant", "[[Roman Legion]] organization (typical ~5,000 troops):\n\n- **Legion (〰️)** — ~5,500 men under a [[Legate]] (senatorial commander)\n- **Cohort** — ~480 men under a [[Prefect]], 10 per legion\n- **Maniple** — ~120-200 men under a [[Centurion]], 2-3 per cohort\n- **Century** — ~80 men under a [[Centurion]] (confusing name — actually smaller unit!)\n- **Contubernium** — 8 soldiers sharing tent\n\nCenturions were career officers (non-commissioned), the backbone of Roman military discipline and professionalism."),
        ("user", "What made Roman tactics superior to barbarian forces?"),
        ("assistant", "Roman advantages in [[Tactics]] and [[Discipline]]:\n\n1. **Formation discipline** — Tight formations (testudo, phalanx variants) vs individual combat\n2. **Centurion command** — Professional NCOs enforced discipline; barbarian warband leaders couldn't control troops from distance\n3. **Standardized weapons** — Romans used uniform equipment; barbarians used diverse weapons\n4. **Fortifications** — Romans built camps/forts methodically; barbarians relied on ambush tactics\n5. **Logistics** — Roman supply lines supported sustained campaigns; barbarian raids lasted weeks\n6. **Training** — Years of drill vs seasonal warriors. Well-trained soldier beats brave amateur\n\nOver time, barbarians adopted Roman tactics, bridging the gap."),
    ];
    for (role, content) in &rome_msgs_2 {
        let mid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![mid, session_rome_2, role, content, now],
        ).map_err(|e| e.to_string())?;
    }

    // Concepts for Rome workspace — expanded
    let rome_concepts: Vec<(&str, &str, &str, &str)> = vec![
        ("demo-concept-caesar-000000000000000001", "Julius Caesar", "General and statesman who transformed Roman Republic into Empire.", "person"),
        ("demo-concept-republic-00000000000000001", "Roman Republic", "Ancient Roman civilization (509–27 BC) with republican government.", "topic"),
        ("demo-concept-augustus-000000000000000001", "Augustus", "First Roman Emperor (Octavian). Maintained republican facades while holding absolute power.", "person"),
        ("demo-concept-senate-0000000000000000001", "Roman Senate", "Governing body gradually losing power to military strongmen in late Republic.", "custom"),
        ("demo-concept-legion-000000000000000001", "Roman Legion", "Military unit (~5,500 troops) organized into cohorts, maniples, centuries, contubernium.", "resource"),
        ("demo-concept-centurion-0000000000000001", "Centurion", "Professional military officer commanding century (~80 troops). Backbone of Roman discipline.", "definition"),
        ("demo-concept-marius-00000000000000001", "Gaius Marius", "Military reformer who professionalized legions and shifted loyalty from state to general.", "person"),
        ("demo-concept-cicero-00000000000000001", "Cicero", "Orator and statesman who opposed [[Caesar]] and [[Mark Antony]] in final Republic crisis.", "person"),
        ("demo-concept-tacitus-00000000000000001", "Tacitus", "Historian documenting Roman-Germanic conflicts and military tactics.", "person"),
    ];
    for (id, name, desc, ctype) in &rome_concepts {
        conn.execute(
            "INSERT OR IGNORE INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, '[]', '[]', '[]', 0, 0, 0, ?6, ?7)",
            rusqlite::params![id, DEMO_WS_ROME, name, desc, ctype, now, now],
        ).map_err(|e| e.to_string())?;
    }

    let rome_links: Vec<(&str, &str, &str)> = vec![
        ("demo-concept-caesar-000000000000000001", "demo-concept-republic-00000000000000001", "related"),
        ("demo-concept-augustus-000000000000000001", "demo-concept-caesar-000000000000000001", "supports"),
        ("demo-concept-senate-0000000000000000001", "demo-concept-republic-00000000000000001", "part_of"),
        ("demo-concept-marius-00000000000000001", "demo-concept-legion-000000000000000001", "supports"),
        ("demo-concept-centurion-0000000000000001", "demo-concept-legion-000000000000000001", "part_of"),
        ("demo-concept-cicero-00000000000000001", "demo-concept-caesar-000000000000000001", "contradicts"),
        ("demo-concept-tacitus-00000000000000001", "demo-concept-legion-000000000000000001", "related"),
    ];
    for (src, tgt, ltype) in &rome_links {
        let lid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT OR IGNORE INTO concept_links (id, source_id, target_id, link_type, strength, context, created_at) VALUES (?1, ?2, ?3, ?4, 0.8, '', ?5)",
            rusqlite::params![lid, src, tgt, ltype, now],
        ).map_err(|e| e.to_string())?;
    }

    // Flashcards for Rome workspace — expanded
    let rome_cards: Vec<(&str, &str)> = vec![
        ("What ended the Roman Republic?", "Civil wars culminating in Augustus defeating Antony at Actium (31 BC), becoming first Emperor (27 BC)."),
        ("When did Caesar cross the Rubicon?", "49 BC. Bringing his army past Rome's pomerium was act of war, triggering civil war with Pompey."),
        ("What was Marius's military reform?", "Professionalized legions by recruiting poor citizens and paying them. Soldiers became loyal to generals, destabilizing the state."),
        ("Describe a Roman legion.", "~5,500 troops organized: 10 cohorts, each with maniples/centuries. Centurions (professional NCOs) enforced discipline."),
        ("What is a centurion?", "Professional military officer commanding century (~80 troops). The backbone of Roman military organization and discipline."),
        ("Why were Roman tactics superior?", "Formation discipline, centurion command, standardized weapons, fortifications, logistics, and years of training vs seasonal warriors."),
        ("What did Augustus accomplish?", "Ended civil wars, became first Emperor. Kept republican institutions as cover while consolidating absolute power."),
        ("Name three figures in the Republic's fall.", "Julius Caesar, Octavian (Augustus), Pompey, Marius, Cicero, Antony. All played roles in the ~100 year decline."),
    ];
    for (front, back) in &rome_cards {
        let cid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO learning_cards (id, workspace_id, front, back, source_type, ease_factor, interval, repetitions, next_review_date, created_at) VALUES (?1, ?2, ?3, ?4, 'ai_generated', 2.5, 1, 0, ?5, ?6)",
            rusqlite::params![cid, DEMO_WS_ROME, front, back, today, now],
        ).map_err(|e| e.to_string())?;
    }

    // Daily notes for Rome workspace (past 7 days)
    for days_ago in 0..7i64 {
        let date = (chrono::Utc::now() - chrono::Duration::days(days_ago)).format("%Y-%m-%d").to_string();
        let dnid = uuid::Uuid::new_v4().to_string();
        let content = if days_ago == 0 {
            format!("## Daily Note — {date}\n\nRoman military organization is fascinating. Centurions were essentially NCOs running the machine.\n\n- Researched legion structure from primary sources\n- Compared Roman vs barbarian tactics\n- Built out Roman military concept map")
        } else if days_ago == 3 {
            format!("## Daily Note — {date}\n\nDeep dive into late Republican politics and institutional decay.\n\n- Mapped timeline from Gracchi to Augustus\n- Added concept links between Caesar → Republic → Senate\n- Reviewed flashcards on key figures and dates\n- Connected military reforms (Marius) to political instability")
        } else {
            format!("## Daily Note — {date}\n\nContinuing study of Rome's political transformation.\n\n- Read about Octavian's rise and elimination of rivals\n- Reviewed Augustus's consolidation of power\n- Updated notes on civil war period")
        };
        conn.execute(
            "INSERT OR IGNORE INTO daily_notes (id, workspace_id, date, content, mood, productivity, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 9, 9, ?5, ?6)",
            rusqlite::params![dnid, DEMO_WS_ROME, date, content, now, now],
        ).map_err(|e| e.to_string())?;
    }

    // Rome Workspace: Source Document
    conn.execute(
        "INSERT INTO sources (id, workspace_id, source_type, title, filename, file_type, content, is_processed, created_at, updated_at)
         VALUES (?1, ?2, 'document', 'Res Gestae Divi Augusti (Excerpts)', 'res_gestae.md', 'markdown', ?3, 1, ?4, ?5)",
        rusqlite::params![
            DEMO_SOURCE_ROME_RES_GESTAE,
            DEMO_WS_ROME,
            "The Res Gestae Divi Augusti is the funerary inscription of the first Roman emperor, Augustus, giving a first-person record of his life and accomplishments.

Notable achievements:
- Transitioned Rome from Republic to Empire
- Initiated the Pax Romana
- Vastly expanded the empire's borders
- Major public building programs in Rome",
            now,
            now
        ],
    ).map_err(|e| e.to_string())?;

    // Rome Workspace: Source Chunks
    let rome_chunks = vec![
        "The Res Gestae Divi Augusti is the funerary inscription of the first Roman emperor, Augustus.",
        "Notable achievements: Transitioned Rome from Republic to Empire and Initiated the Pax Romana."
    ];
    for (i, chunk) in rome_chunks.iter().enumerate() {
        let chunk_id = format!("{}-chunk-{}", DEMO_SOURCE_ROME_RES_GESTAE, i);
        conn.execute(
            "INSERT INTO source_chunks (id, source_id, content, chunk_index, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![chunk_id, DEMO_SOURCE_ROME_RES_GESTAE, chunk, i as i32, now],
        ).map_err(|e| e.to_string())?;
    }

    // Rome Workspace: Memory
    conn.execute(
        "INSERT INTO memories (id, workspace_id, content, memory_type, scope, created_at, updated_at)
         VALUES (?1, ?2, 'Interested in the transition from late Republic to early Principate, specifically institutional continuity.', 'preference', 'workspace', ?3, ?4)",
        rusqlite::params![DEMO_MEMORY_ROME_PREF, DEMO_WS_ROME, now, now],
    ).map_err(|e| e.to_string())?;

    // Rome Workspace: Learning Goal
    conn.execute(
        "INSERT INTO learning_goals (id, workspace_id, title, goal_description, progress, is_completed, due_date, prerequisite_ids, related_chat_ids, created_at, updated_at)
         VALUES (?1, ?2, 'Analyze the Punic Wars', 'Detailed study of the three conflicts between Rome and Carthage.', 0.2, 0, ?3, '[]', '[]', ?4, ?5)",
        rusqlite::params![
            DEMO_GOAL_ROME_PUNIC,
            DEMO_WS_ROME,
            (chrono::Utc::now() + chrono::Duration::days(30)).format("%Y-%m-%d").to_string(),
            now,
            now
        ],
    ).map_err(|e| e.to_string())?;

    // Rome Workspace: Project Note
    conn.execute(
        "INSERT INTO project_notes (id, workspace_id, title, content, note_type, tags, created_at, updated_at)
         VALUES (?1, ?2, 'Duties of a Legionary Legate', ?3, 'manual', '[\"military\", \"organization\"]', ?4, ?5)",
        rusqlite::params![
            DEMO_NOTE_ROME_LEGATE,
            DEMO_WS_ROME,
            "The Legatus Legionis was the commander of a Roman legion.

### Responsibilities:
- Operational command during campaigns
- Ensuring discipline and training within the legion
- Coordination with other legates and the provincial governor
- Administrative oversight of the legionary camp",
            now,
            now
        ],
    ).map_err(|e| e.to_string())?;

    // Return the first workspace ID as the initially active one
    Ok(DEMO_WS_AI.to_string())
}

#[tauri::command]
pub fn deactivate_demo_mode(state: State<DbState>) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    // CASCADE deletes all demo data (projects, chats, concepts, etc.)
    // We use a wildcard to ensure any stray demo workspaces are cleaned up
    conn.execute("DELETE FROM workspaces WHERE id LIKE 'demo-%'", rusqlite::params![])
        .map_err(|e| e.to_string())?;
    Ok(())
}
