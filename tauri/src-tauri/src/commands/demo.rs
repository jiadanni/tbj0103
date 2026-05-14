use crate::db::DbState;
use crate::models::workspace::CreateWorkspaceRequest;
use crate::services::workspace_service;
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
        "INSERT INTO folders (id, workspace_id, name, folder_description, color, icon, created_at, updated_at) VALUES (?1, ?2, 'Transformer Architecture', 'Deep dive into attention mechanisms and transformer models', '#007AFF', 'brain', ?3, ?4)",
        rusqlite::params![DEMO_PROJECT_AI, DEMO_WS_AI, now, now],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO folders (id, workspace_id, name, folder_description, color, icon, created_at, updated_at) VALUES (?1, ?2, 'Large Language Models', 'Practical applications and fine-tuning of LLMs', '#5AC8FA', 'rectangle.stack.fill', ?3, ?4)",
        rusqlite::params![DEMO_PROJECT_AI_LLMS, DEMO_WS_AI, now, now],
    ).map_err(|e| e.to_string())?;

    // AI Workspace Chats (22 total)
    let ai_chats = vec![
        ("demo-chat-session-transformers-001", DEMO_PROJECT_AI, "What is Self-Attention?", vec![
            ("user", "Can you explain how self-attention works in transformers?"),
            ("assistant", "Self-attention allows each token in a sequence to attend to every other token, computing relevance scores. It uses **Query (Q)**, **Key (K)**, and **Value (V)** vectors. The score is `softmax(QK^T / √d_k)V`. See [[Attention Mechanism]]."),
        ]),
        ("demo-chat-session-ai-scaling-001", DEMO_PROJECT_AI_LLMS, "Scaling Laws and Emergent Abilities", vec![
            ("user", "What are scaling laws in deep learning?"),
            ("assistant", "[[Scaling Laws]] describe predictable performance improvements with scale. Models also show [[Emergent Abilities]] like chain-of-thought reasoning that only appear at certain sizes."),
        ]),
        ("demo-chat-session-ai-gradient-001", DEMO_PROJECT_AI, "Gradient Descent Basics", vec![
            ("user", "How does gradient descent work?"),
            ("assistant", "It's an optimization algorithm that minimizes a loss function by iteratively moving in the direction of steepest descent, defined by the negative of the gradient."),
        ]),
        ("demo-chat-session-ai-cnn-001", DEMO_PROJECT_AI, "Convolutional Neural Networks", vec![
            ("user", "What makes CNNs good for images?"),
            ("assistant", "CNNs use convolutional layers to learn spatial hierarchies of features, making them translation invariant and highly efficient for visual data."),
        ]),
        ("demo-chat-session-ai-rnn-001", DEMO_PROJECT_AI, "RNNs vs LSTMs", vec![
            ("user", "Why use LSTMs over standard RNNs?"),
            ("assistant", "Standard RNNs suffer from vanishing gradients. LSTMs introduce 'gates' to selectively remember or forget information over long sequences."),
        ]),
        ("demo-chat-session-ai-rl-001", DEMO_PROJECT_AI, "Reinforcement Learning", vec![
            ("user", "What is the core idea of RL?"),
            ("assistant", "An agent learns to make decisions by performing actions in an environment to maximize a cumulative reward signal."),
        ]),
        ("demo-chat-session-ai-gan-001", DEMO_PROJECT_AI, "Generative Adversarial Networks", vec![
            ("user", "How do GANs train?"),
            ("assistant", "Two networks, a Generator and a Discriminator, compete in a zero-sum game. The generator tries to fool the discriminator with synthetic data."),
        ]),
        ("demo-chat-session-ai-transfer-001", DEMO_PROJECT_AI_LLMS, "Transfer Learning", vec![
            ("user", "Why is transfer learning so popular?"),
            ("assistant", "It allows using a pre-trained model on a large dataset as a starting point for a smaller, task-specific dataset, saving time and compute."),
        ]),
        ("demo-chat-session-ai-ethics-001", DEMO_PROJECT_AI_LLMS, "AI Ethics and Bias", vec![
            ("user", "How can we mitigate bias in AI?"),
            ("assistant", "Through diverse datasets, algorithmic fairness constraints, and rigorous testing for disparate impact across different demographic groups."),
        ]),
        ("demo-chat-session-ai-healthcare-001", DEMO_PROJECT_AI_LLMS, "AI in Healthcare", vec![
            ("user", "How is AI used in medical diagnostics?"),
            ("assistant", "AI models analyze medical images (X-rays, MRIs) to detect anomalies with high precision, often aiding doctors in early disease detection."),
        ]),
        ("demo-chat-session-ai-cv-001", DEMO_PROJECT_AI, "Object Detection", vec![
            ("user", "How does YOLO work?"),
            ("assistant", "YOLO (You Only Look Once) treats object detection as a regression problem to spatially separated bounding boxes and associated class probabilities."),
        ]),
        ("demo-chat-session-ai-nlp-001", DEMO_PROJECT_AI_LLMS, "BERT vs GPT", vec![
            ("user", "What's the difference between BERT and GPT?"),
            ("assistant", "BERT is an encoder-only model designed for bidirectional context, while GPT is a decoder-only model designed for generative tasks."),
        ]),
        ("demo-chat-session-ai-tuning-001", DEMO_PROJECT_AI, "Hyperparameter Tuning", vec![
            ("user", "What's better: Grid Search or Bayesian Optimization?"),
            ("assistant", "Bayesian Optimization is generally more efficient as it uses prior results to inform the next search, unlike the exhaustive Grid Search."),
        ]),
        ("demo-chat-session-ai-reg-001", DEMO_PROJECT_AI, "Regularization Techniques", vec![
            ("user", "Explain Dropout."),
            ("assistant", "Dropout randomly ignores neurons during training, which prevents the model from over-relying on specific features and improves generalization."),
        ]),
        ("demo-chat-session-ai-diffusion-001", DEMO_PROJECT_AI_LLMS, "Diffusion Models", vec![
            ("user", "How do Stable Diffusion models work?"),
            ("assistant", "They learn to reverse a process of adding noise to an image, starting from pure noise and iteratively refining it into a clear image."),
        ]),
        ("demo-chat-session-ai-rag-001", DEMO_PROJECT_AI_LLMS, "Vector DBs for RAG", vec![
            ("user", "Why do we need vector databases for RAG?"),
            ("assistant", "Vector DBs allow for efficient similarity searches of embeddings, enabling the retrieval of relevant context for LLM prompts."),
        ]),
        ("demo-chat-session-ai-quant-001", DEMO_PROJECT_AI_LLMS, "Model Quantization", vec![
            ("user", "What is 4-bit quantization?"),
            ("assistant", "It involves compressing model weights into 4-bit integers, significantly reducing memory footprint with minimal accuracy loss."),
        ]),
        ("demo-chat-session-ai-safety-001", DEMO_PROJECT_AI_LLMS, "AI Safety and Alignment", vec![
            ("user", "What is the goal of AI alignment?"),
            ("assistant", "To ensure that AI systems' goals and behaviors are aligned with human values and intentions, preventing harmful or unintended outcomes."),
        ]),
        ("demo-chat-session-ai-synthetic-001", DEMO_PROJECT_AI_LLMS, "Synthetic Data", vec![
            ("user", "When should we use synthetic data?"),
            ("assistant", "When real data is scarce, expensive to collect, or sensitive (privacy concerns). It can also help balance underrepresented classes."),
        ]),
        ("demo-chat-session-ai-multimodal-001", DEMO_PROJECT_AI_LLMS, "Multi-modal Models", vec![
            ("user", "What is a multi-modal model?"),
            ("assistant", "A model that can process and relate information from different types of input, such as text, images, and audio, simultaneously."),
        ]),
        ("demo-chat-session-ai-nas-001", DEMO_PROJECT_AI, "Neural Architecture Search", vec![
            ("user", "What is NAS?"),
            ("assistant", "NAS automates the design of neural networks, using algorithms to find the optimal architecture for a given task and dataset."),
        ]),
        ("demo-chat-session-ai-federated-001", DEMO_PROJECT_AI_LLMS, "Federated Learning", vec![
            ("user", "How does federated learning preserve privacy?"),
            ("assistant", "It trains models across multiple decentralized devices holding local data samples, without ever exchanging the actual data."),
        ]),
    ];

    for (id, pid, title, msgs) in ai_chats {
        create_demo_chat(&conn, DEMO_WS_AI, pid, id, title, msgs, &now)?;
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
    let ai_chunks = [
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
            "demo-chat-session-transformers-001",
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
            format!("[\"{}\"]", "demo-chat-session-transformers-001"),
            now,
            now
        ],
    ).map_err(|e| e.to_string())?;

    // AI Workspace: Folder Note
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
        "INSERT INTO folders (id, workspace_id, name, folder_description, color, icon, created_at, updated_at) VALUES (?1, ?2, 'Harmony & Chords', 'Understanding chord construction, inversions, and progressions', '#34C759', 'music.note.list', ?3, ?4)",
        rusqlite::params![DEMO_PROJECT_MUSIC_HARMONY, DEMO_WS_MUSIC, now, now],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO folders (id, workspace_id, name, folder_description, color, icon, created_at, updated_at) VALUES (?1, ?2, 'Rhythm & Meter', 'Time signatures, subdivisions, and rhythmic patterns', '#AF52DE', 'metronome', ?3, ?4)",
        rusqlite::params![DEMO_PROJECT_MUSIC_RHYTHM, DEMO_WS_MUSIC, now, now],
    ).map_err(|e| e.to_string())?;

    // Music Workspace Chats (22 total)
    let music_chats = vec![
        ("demo-chat-session-music-harmony-001", DEMO_PROJECT_MUSIC_HARMONY, "How do chord progressions work?", vec![
            ("user", "Can you explain how chord progressions work and why some sound more natural?"),
            ("assistant", "[[Chord Progressions]] are sequences built from [[Major Scale]] degrees. Progressions sound natural following the circle of fifths. The most common is **I → V → vi → IV**. See [[Tritone]]."),
        ]),
        ("demo-chat-session-music-rhythm-001", DEMO_PROJECT_MUSIC_RHYTHM, "Understanding Time Signatures", vec![
            ("user", "What does 4/4 time signature mean?"),
            ("assistant", "In 4/4 [[Time Signature]]: 4 beats per measure, and the quarter note gets the beat. It's the most common time signature in Western music."),
        ]),
        ("demo-chat-session-music-piano-001", DEMO_PROJECT_MUSIC_HARMONY, "History of the Piano", vec![
            ("user", "Who invented the piano?"),
            ("assistant", "Bartolomeo Cristofori invented the piano around 1700 in Italy. It was originally called 'gravicembalo col piano e forte' (harpsichord with soft and loud)."),
        ]),
        ("demo-chat-session-music-sonata-001", DEMO_PROJECT_MUSIC_HARMONY, "Sonata Form Analysis", vec![
            ("user", "What are the parts of a sonata form?"),
            ("assistant", "Sonata form typically has three main sections: **Exposition** (themes introduced), **Development** (themes explored), and **Recapitulation** (themes return)."),
        ]),
        ("demo-chat-session-music-fugue-001", DEMO_PROJECT_MUSIC_HARMONY, "Fugue Construction", vec![
            ("user", "What is a fugue?"),
            ("assistant", "A fugue is a contrapuntal composition in which a short melody (the subject) is introduced by one part and successively taken up by others and developed."),
        ]),
        ("demo-chat-session-music-jazz-001", DEMO_PROJECT_MUSIC_HARMONY, "Modal Jazz Basics", vec![
            ("user", "How does modal jazz differ from tonal jazz?"),
            ("assistant", "Modal jazz relies on musical modes rather than chord progressions (tonal center). Miles Davis's 'Kind of Blue' is the definitive example."),
        ]),
        ("demo-chat-session-music-orch-001", DEMO_PROJECT_MUSIC_HARMONY, "Orchestration Techniques", vec![
            ("user", "What is orchestration?"),
            ("assistant", "Orchestration is the study or practice of writing music for an orchestra or of adapting music composed for another medium for an orchestra."),
        ]),
        ("demo-chat-session-music-romance-001", DEMO_PROJECT_MUSIC_HARMONY, "Chopin vs Liszt", vec![
            ("user", "How did their styles differ?"),
            ("assistant", "Chopin focused on intimacy, nuance, and poetic expression, while Liszt was known for his bravura, technical virtuosity, and orchestral approach to the piano."),
        ]),
        ("demo-chat-session-music-electronic-001", DEMO_PROJECT_MUSIC_RHYTHM, "Electronic Music Basics", vec![
            ("user", "What is a synthesizer?"),
            ("assistant", "An electronic musical instrument that generates audio signals. Synthesizers can imitate traditional instruments or create completely new sounds."),
        ]),
        ("demo-chat-session-music-scales-001", DEMO_PROJECT_MUSIC_HARMONY, "World Music Scales", vec![
            ("user", "What is a Raga?"),
            ("assistant", "In Indian classical music, a Raga is a melodic framework for improvisation and composition, associated with specific moods or times of day."),
        ]),
        ("demo-chat-session-music-min-001", DEMO_PROJECT_MUSIC_RHYTHM, "Minimalism: Steve Reich", vec![
            ("user", "What is phasing in music?"),
            ("assistant", "A technique where two identical parts begin in unison but gradually shift out of sync, creating complex rhythmic patterns. Used extensively by Steve Reich."),
        ]),
        ("demo-chat-session-music-counter-001", DEMO_PROJECT_MUSIC_HARMONY, "Species Counterpoint", vec![
            ("user", "What is first species counterpoint?"),
            ("assistant", "It involves writing one note for every note in the given melody (cantus firmus), following strict rules about allowable intervals."),
        ]),
        ("demo-chat-session-music-notation-001", DEMO_PROJECT_MUSIC_HARMONY, "Notation History", vec![
            ("user", "When did modern notation start?"),
            ("assistant", "Standardized Western notation began to emerge in the 11th century with Guido d'Arezzo, who introduced the four-line staff."),
        ]),
        ("demo-chat-session-music-film-001", DEMO_PROJECT_MUSIC_HARMONY, "Film Scoring Magic", vec![
            ("user", "What is a leitmotif?"),
            ("assistant", "A recurring musical theme associated with a particular person, place, or idea, famously used by Wagner and John Williams."),
        ]),
        ("demo-chat-session-music-opera-001", DEMO_PROJECT_MUSIC_HARMONY, "Opera vs Operetta", vec![
            ("user", "What's the difference?"),
            ("assistant", "Opera is usually entirely sung and serious, while operetta is shorter, lighter, and often includes spoken dialogue and dance."),
        ]),
        ("demo-chat-session-music-sound-001", DEMO_PROJECT_MUSIC_HARMONY, "Acoustic vs Digital", vec![
            ("user", "What is sampling?"),
            ("assistant", "The technique of taking a portion, or sample, of one sound recording and reusing it as an instrument or a different sound recording in a new piece."),
        ]),
        ("demo-chat-session-music-tempo-001", DEMO_PROJECT_MUSIC_RHYTHM, "Tempo and Dynamics", vec![
            ("user", "What does 'rubato' mean?"),
            ("assistant", "It refers to expressive and rhythmic freedom by a slight speeding up and then slowing down of the tempo of a piece at the discretion of the soloist."),
        ]),
        ("demo-chat-session-music-psycho-001", DEMO_PROJECT_MUSIC_HARMONY, "Psychoacoustics", vec![
            ("user", "How do we perceive pitch?"),
            ("assistant", "Pitch perception is the brain's interpretation of the frequency of sound waves. It involves both the physical stimulus and psychological processing."),
        ]),
        ("demo-chat-session-music-wood-001", DEMO_PROJECT_MUSIC_HARMONY, "Woodwind Comparison", vec![
            ("user", "Oboe vs Clarinet?"),
            ("assistant", "The oboe is a double-reed instrument with a conical bore, while the clarinet is a single-reed instrument with a cylindrical bore."),
        ]),
        ("demo-chat-session-music-vocal-001", DEMO_PROJECT_MUSIC_HARMONY, "Vocal Ranges: SATB", vec![
            ("user", "What does SATB stand for?"),
            ("assistant", "Soprano, Alto, Tenor, Bass — the four standard voice types in choral music."),
        ]),
        ("demo-chat-session-music-cond-001", DEMO_PROJECT_MUSIC_RHYTHM, "Choral Conducting", vec![
            ("user", "What is the ictus?"),
            ("assistant", "The point in a conducting gesture that indicates the exact moment of the beat."),
        ]),
        ("demo-chat-session-music-imp-001", DEMO_PROJECT_MUSIC_HARMONY, "Improvisation Tips", vec![
            ("user", "How to start improvising?"),
            ("assistant", "Start by embellishing the melody, then move to using scale tones over the underlying harmony, and practice rhythmic variations."),
        ]),
    ];

    for (id, pid, title, msgs) in music_chats {
        create_demo_chat(&conn, DEMO_WS_MUSIC, pid, id, title, msgs, &now)?;
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
    let music_chunks = [
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
        "INSERT INTO folders (id, workspace_id, name, folder_description, color, icon, created_at, updated_at) VALUES (?1, ?2, 'Fall of the Republic', 'The transformation from Republic to Empire', '#FF9500', 'building.columns', ?3, ?4)",
        rusqlite::params![DEMO_PROJECT_ROME, DEMO_WS_ROME, now, now],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO folders (id, workspace_id, name, folder_description, color, icon, created_at, updated_at) VALUES (?1, ?2, 'Roman Military', 'Legions, tactics, and military organization of Rome', '#FF3B30', 'shield.fill', ?3, ?4)",
        rusqlite::params![DEMO_PROJECT_ROME_MILITARY, DEMO_WS_ROME, now, now],
    ).map_err(|e| e.to_string())?;

    // Roman History Workspace Chats (22 total)
    let rome_chats = vec![
        ("demo-chat-session-rome-republic-001", DEMO_PROJECT_ROME, "Fall of the Roman Republic", vec![
            ("user", "What caused the fall of the Roman Republic?"),
            ("assistant", "The fall was driven by land reform conflicts, military loyalty shifting to generals (see [[Marius]]), and the rise of dictators like [[Julius Caesar]]."),
        ]),
        ("demo-chat-session-rome-military-001", DEMO_PROJECT_ROME_MILITARY, "Roman Legions and Military Organization", vec![
            ("user", "What was the structure of a Roman legion?"),
            ("assistant", "A [[Roman Legion]] had ~5,500 men, organized into cohorts, maniples, and centuries, led by a [[Legate]] and professional [[Centurion]]s."),
        ]),
        ("demo-chat-session-rome-punic-001", DEMO_PROJECT_ROME, "The Punic Wars: Hannibal", vec![
            ("user", "Who was Hannibal Barca?"),
            ("assistant", "The Carthaginian general who famously crossed the Alps with elephants to attack Rome from the north during the Second Punic War."),
        ]),
        ("demo-chat-session-rome-life-001", DEMO_PROJECT_ROME, "Daily Life in Ancient Rome", vec![
            ("user", "What did Romans eat?"),
            ("assistant", "The diet consisted mainly of grain (bread/porridge), olive oil, and wine, supplemented by vegetables, cheese, and occasionally meat or fish."),
        ]),
        ("demo-chat-session-rome-eng-001", DEMO_PROJECT_ROME_MILITARY, "Roman Engineering: Aqueducts", vec![
            ("user", "How did aqueducts work?"),
            ("assistant", "They used a slight downward gradient and gravity to transport water over long distances into cities, using arches to maintain the slope over valleys."),
        ]),
        ("demo-chat-session-rome-games-001", DEMO_PROJECT_ROME, "The Coliseum and Games", vec![
            ("user", "What happened at the Coliseum?"),
            ("assistant", "It hosted gladiatorial contests, mock sea battles, animal hunts, and executions, serving as the center of Roman public entertainment."),
        ]),
        ("demo-chat-session-rome-pompeii-001", DEMO_PROJECT_ROME, "Pompeii: Snapshot in Time", vec![
            ("user", "What happened in 79 AD?"),
            ("assistant", "Mount Vesuvius erupted, burying Pompeii and Herculaneum in volcanic ash, preserving them for centuries as unique archaeological sites."),
        ]),
        ("demo-chat-session-rome-pax-001", DEMO_PROJECT_ROME, "Pax Romana: Stability", vec![
            ("user", "What was the Pax Romana?"),
            ("assistant", "A long period of relative peace and stability across the Roman Empire, beginning with the reign of [[Augustus]] in 27 BC."),
        ]),
        ("demo-chat-session-rome-law-001", DEMO_PROJECT_ROME, "Roman Law: Twelve Tables", vec![
            ("user", "What were the Twelve Tables?"),
            ("assistant", "The earliest attempt by the Romans to create a code of law, binding both patricians and plebeians, forming the foundation of Roman law."),
        ]),
        ("demo-chat-session-rome-rel-001", DEMO_PROJECT_ROME, "Religion in Rome", vec![
            ("user", "Who were the main Roman gods?"),
            ("assistant", "The Capitoline Triad consisted of Jupiter (king), Juno (queen), and Minerva (wisdom), often adapted from Greek counterparts."),
        ]),
        ("demo-chat-session-rome-slave-001", DEMO_PROJECT_ROME_MILITARY, "Slavery in the Empire", vec![
            ("user", "How common was slavery?"),
            ("assistant", "Slavery was foundational to the Roman economy. Slaves worked in agriculture, mining, domestic service, and even highly skilled professions."),
        ]),
        ("demo-chat-session-rome-byz-001", DEMO_PROJECT_ROME, "Byzantine Empire: East", vec![
            ("user", "When did the West fall?"),
            ("assistant", "The Western Roman Empire fell in 476 AD, but the Eastern half (Byzantine Empire) survived in Constantinople until 1453."),
        ]),
        ("demo-chat-session-rome-women-001", DEMO_PROJECT_ROME, "Women in Roman Society", vec![
            ("user", "What rights did Roman women have?"),
            ("assistant", "They couldn't vote or hold office, but they could own property, engage in business, and had more freedom than their Greek counterparts."),
        ]),
        ("demo-chat-session-rome-lit-001", DEMO_PROJECT_ROME, "Roman Literature: Virgil", vec![
            ("user", "What is the Aeneid?"),
            ("assistant", "An epic poem by Virgil that tells the legendary story of Aeneas, a Trojan who travelled to Italy, where he became the ancestor of the Romans."),
        ]),
        ("demo-chat-session-rome-silk-001", DEMO_PROJECT_ROME, "Silk Road and Trade", vec![
            ("user", "Did Rome trade with China?"),
            ("assistant", "Indirectly, yes. Silk from China reached Rome via the Silk Road, while Roman glass and coins have been found as far east as Vietnam."),
        ]),
        ("demo-chat-session-rome-barb-001", DEMO_PROJECT_ROME_MILITARY, "Barbarian Invasions", vec![
            ("user", "Who were the Goths?"),
            ("assistant", "Germanic tribes whose migrations and invasions, particularly the sack of Rome in 410 AD, played a key role in the Western Empire's fall."),
        ]),
        ("demo-chat-session-rome-coin-001", DEMO_PROJECT_ROME, "Roman Coinage and Economy", vec![
            ("user", "What was a denarius?"),
            ("assistant", "The standard Roman silver coin for centuries. Currency debasement later contributed to the economic crises of the late Empire."),
        ]),
        ("demo-chat-session-rome-guard-001", DEMO_PROJECT_ROME_MILITARY, "The Praetorian Guard", vec![
            ("user", "What was the Guard's role?"),
            ("assistant", "Originally the Emperor's personal bodyguards, they became a powerful political force, often making or breaking emperors themselves."),
        ]),
        ("demo-chat-session-rome-agri-001", DEMO_PROJECT_ROME, "Agriculture: Latifundia", vec![
            ("user", "What were latifundia?"),
            ("assistant", "Large landed estates typically worked by slaves, which displaced small farmers and contributed to the social tensions of the Republic."),
        ]),
        ("demo-chat-session-rome-bath-001", DEMO_PROJECT_ROME, "Roman Baths and Social Life", vec![
            ("user", "Why were baths important?"),
            ("assistant", "Thermae were not just for hygiene; they were social hubs with gyms, libraries, and meeting places for all classes of society."),
        ]),
        ("demo-chat-session-rome-wall-001", DEMO_PROJECT_ROME_MILITARY, "Hadrian's Wall", vec![
            ("user", "Where is Hadrian's Wall?"),
            ("assistant", "It stretched across northern Britain, marking the northernmost limit of the Roman Empire and serving as a defensive fortification."),
        ]),
        ("demo-chat-session-rome-crisis-001", DEMO_PROJECT_ROME, "Crisis of the 3rd Century", vec![
            ("user", "What happened during the Crisis?"),
            ("assistant", "A period of 50 years with near-constant civil war, barbarian invasions, and economic collapse, almost destroying the Empire."),
        ]),
    ];

    for (id, pid, title, msgs) in rome_chats {
        create_demo_chat(&conn, DEMO_WS_ROME, pid, id, title, msgs, &now)?;
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
    let rome_chunks = [
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

    // Rome Workspace: Folder Note
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

    // Disable foreign keys temporarily so we can purge demo data even if some
    // legacy tables (added via migrations) do not have CASCADE constraints.
    conn.execute_batch("PRAGMA foreign_keys=OFF;")
        .map_err(|e| e.to_string())?;

    // Explicitly delete from tables that may hold demo-prefixed rows.
    // Using id LIKE 'demo-%' or workspace_id LIKE 'demo-%' to catch orphans.
    let demo_cleanup_statements: &[&str] = &[
        "DELETE FROM messages WHERE session_id LIKE 'demo-%'",
        "DELETE FROM citations WHERE message_id LIKE 'demo-%'",
        "DELETE FROM chat_sessions WHERE id LIKE 'demo-%' OR workspace_id LIKE 'demo-%'",
        "DELETE FROM folders WHERE id LIKE 'demo-%' OR workspace_id LIKE 'demo-%'",
        "DELETE FROM concept_nodes WHERE id LIKE 'demo-%' OR workspace_id LIKE 'demo-%'",
        "DELETE FROM concept_links WHERE source_id LIKE 'demo-%' OR target_id LIKE 'demo-%'",
        "DELETE FROM concept_mentions WHERE concept_id LIKE 'demo-%' OR source_id LIKE 'demo-%'",
        "DELETE FROM sources WHERE id LIKE 'demo-%' OR workspace_id LIKE 'demo-%'",
        "DELETE FROM source_chunks WHERE source_id LIKE 'demo-%'",
        "DELETE FROM uploaded_documents WHERE id LIKE 'demo-%' OR workspace_id LIKE 'demo-%'",
        "DELETE FROM document_chunks WHERE document_id LIKE 'demo-%'",
        "DELETE FROM web_captures WHERE id LIKE 'demo-%' OR workspace_id LIKE 'demo-%'",
        "DELETE FROM project_notes WHERE id LIKE 'demo-%' OR workspace_id LIKE 'demo-%'",
        "DELETE FROM daily_notes WHERE id LIKE 'demo-%' OR workspace_id LIKE 'demo-%'",
        "DELETE FROM learning_goals WHERE id LIKE 'demo-%' OR workspace_id LIKE 'demo-%'",
        "DELETE FROM learning_cards WHERE id LIKE 'demo-%' OR workspace_id LIKE 'demo-%'",
        "DELETE FROM learning_paths WHERE id LIKE 'demo-%' OR workspace_id LIKE 'demo-%'",
        "DELETE FROM memories WHERE id LIKE 'demo-%' OR workspace_id LIKE 'demo-%'",
        "DELETE FROM memory_embeddings WHERE memory_id LIKE 'demo-%'",
        "DELETE FROM artifacts WHERE id LIKE 'demo-%' OR workspace_id LIKE 'demo-%'",
        "DELETE FROM artifact_embeddings WHERE artifact_id LIKE 'demo-%'",
        "DELETE FROM conversation_summaries WHERE id LIKE 'demo-%' OR session_id LIKE 'demo-%' OR workspace_id LIKE 'demo-%'",
        "DELETE FROM context_snapshots WHERE id LIKE 'demo-%' OR session_id LIKE 'demo-%'",
        "DELETE FROM thought_queue WHERE id LIKE 'demo-%' OR workspace_id LIKE 'demo-%'",
        "DELETE FROM audio_transcriptions WHERE id LIKE 'demo-%' OR workspace_id LIKE 'demo-%'",
        "DELETE FROM calendar_alarms WHERE id LIKE 'demo-%' OR workspace_id LIKE 'demo-%'",
        "DELETE FROM note_templates WHERE id LIKE 'demo-%' OR workspace_id LIKE 'demo-%'",
        "DELETE FROM workspaces WHERE id LIKE 'demo-%'",
    ];

    for stmt in demo_cleanup_statements {
        // Ignore individual errors (e.g. table may not exist in some schema versions)
        // but log them for diagnostics.
        if let Err(e) = conn.execute(stmt, rusqlite::params![]) {
            eprintln!("demo cleanup warning ({}): {}", stmt, e);
        }
    }

    // Re-enable foreign keys
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;

    // Check if there are any workspaces left
    let workspace_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM workspaces WHERE is_hidden = 0",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    // If no workspaces remain, create a default one
    if workspace_count == 0 {
        let req = CreateWorkspaceRequest {
            name: "My Workspace".to_string(),
            description: None,
        };
        workspace_service::create(&conn, req)
            .map_err(|e| format!("Failed to create default workspace: {}", e))?;
    }

    Ok(())
}

fn create_demo_chat(
    conn: &rusqlite::Connection,
    ws_id: &str,
    folder_id: &str,
    session_id: &str,
    title: &str,
    messages: Vec<(&str, &str)>,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO chat_sessions (id, workspace_id, folder_id, title, model_name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, '', ?5, ?6)",
        rusqlite::params![session_id, ws_id, folder_id, title, now, now],
    ).map_err(|e| e.to_string())?;

    for (role, content) in messages {
        let mid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![mid, session_id, role, content, now],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}
