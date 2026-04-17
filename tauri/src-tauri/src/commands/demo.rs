use crate::db::DbState;
use tauri::State;

/// Demo mode: seeds temporary workspaces with sample data.
/// Each workspace showcases a different subject area.
/// All demo data uses hardcoded IDs so it can be cleanly removed on deactivate.

const DEMO_WS_AI: &str = "demo-workspace-ai-ml-000000000000000";
const DEMO_WS_MUSIC: &str = "demo-workspace-music-theory-0000000";
const DEMO_WS_ROME: &str = "demo-workspace-rome-000000000000000";

const DEMO_WORKSPACE_IDS: [&str; 3] = [DEMO_WS_AI, DEMO_WS_MUSIC, DEMO_WS_ROME];

const DEMO_PROJECT_AI: &str = "demo-project-transformers-000000000000";
const DEMO_PROJECT_MUSIC_HARMONY: &str = "demo-project-music-harmony-000000000";
const DEMO_PROJECT_MUSIC_RHYTHM: &str = "demo-project-music-rhythm-0000000000";
const DEMO_PROJECT_ROME: &str = "demo-project-rome-0000000000000000000";

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

    // Chat: self-attention
    let session_ai = "demo-chat-session-transformers-00001";
    conn.execute(
        "INSERT INTO chat_sessions (id, workspace_id, project_id, title, model_name, created_at, updated_at) VALUES (?1, ?2, ?3, 'What is Self-Attention?', '', ?4, ?5)",
        rusqlite::params![session_ai, DEMO_WS_AI, DEMO_PROJECT_AI, now, now],
    ).map_err(|e| e.to_string())?;

    let ai_msgs: Vec<(&str, &str)> = vec![
        ("user", "Can you explain how self-attention works in transformers?"),
        ("assistant", "Self-attention allows each token in a sequence to attend to every other token, computing relevance scores (called attention weights). \n\nFor each token, we compute three vectors: **Query (Q)**, **Key (K)**, and **Value (V)**. The attention score between token i and token j is computed as:\n\n```\nAttention(Q,K,V) = softmax(QK^T / √d_k) × V\n```\n\nThe scaling factor `√d_k` prevents vanishing gradients in longer sequences. This mechanism is what allows transformers to capture long-range dependencies that RNNs struggled with. See [[Attention Mechanism]] and [[Query Key Value]] for more depth."),
        ("user", "How does multi-head attention differ?"),
        ("assistant", "[[Multi-Head Attention]] runs multiple attention operations in parallel — typically 8 or 16 heads — each with different learned projections. Each head can specialize: one might focus on syntactic relationships, another on semantic similarity.\n\nThe outputs of all heads are concatenated and projected back to the model dimension:\n\n```\nMultiHead(Q,K,V) = Concat(head₁,...,headₕ)W^O\n```\n\nThis dramatically increases the model's representational power without multiplying compute proportionally."),
    ];
    for (role, content) in &ai_msgs {
        let mid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![mid, session_ai, role, content, now],
        ).map_err(|e| e.to_string())?;
    }

    // Concepts for AI workspace
    let ai_concepts: Vec<(&str, &str, &str, &str)> = vec![
        ("demo-concept-attention-0000000000001", "Attention Mechanism", "The core mechanism in transformers that computes weighted relevance between sequence elements.", "technology"),
        ("demo-concept-transformer-000000000001", "Transformer", "A neural network architecture based entirely on attention mechanisms, without recurrence.", "technology"),
        ("demo-concept-qkv-00000000000000000001", "Query Key Value", "The three projection matrices used in attention: Q (what to look for), K (what to match), V (what to retrieve).", "definition"),
        ("demo-concept-mlh-00000000000000000001", "Multi-Head Attention", "Running multiple attention operations in parallel with different learned projections.", "technology"),
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
    ];
    for (src, tgt, ltype) in &ai_links {
        let lid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT OR IGNORE INTO concept_links (id, source_id, target_id, link_type, strength, context, created_at) VALUES (?1, ?2, ?3, ?4, 0.8, '', ?5)",
            rusqlite::params![lid, src, tgt, ltype, now],
        ).map_err(|e| e.to_string())?;
    }

    // Flashcards for AI workspace
    let ai_cards: Vec<(&str, &str)> = vec![
        ("What does Q, K, V stand for in attention?", "Query, Key, Value — Q is what you're looking for, K is what available items advertise, V is what you actually retrieve."),
        ("What is the scaling factor in attention and why?", "√d_k — prevents the dot products from growing too large in high-dimensional spaces, which would push the softmax into regions with tiny gradients."),
    ];
    for (front, back) in &ai_cards {
        let cid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO learning_cards (id, workspace_id, front, back, source_type, ease_factor, interval, repetitions, next_review_date, created_at) VALUES (?1, ?2, ?3, ?4, 'ai_generated', 2.5, 1, 0, ?5, ?6)",
            rusqlite::params![cid, DEMO_WS_AI, front, back, today, now],
        ).map_err(|e| e.to_string())?;
    }

    // Daily notes for AI workspace (past 3 days)
    for days_ago in 0..3i64 {
        let date = (chrono::Utc::now() - chrono::Duration::days(days_ago)).format("%Y-%m-%d").to_string();
        let dnid = uuid::Uuid::new_v4().to_string();
        let content = format!("## Daily Note — {date}\n\nLearned about transformer architectures today. Key insight: attention is all you need.\n\n- Read 2 papers on self-attention\n- Reviewed flashcards\n- Created concept links between QKV and Attention Mechanism");
        conn.execute(
            "INSERT OR IGNORE INTO daily_notes (id, workspace_id, date, content, mood, productivity, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 8, 7, ?5, ?6)",
            rusqlite::params![dnid, DEMO_WS_AI, date, content, now, now],
        ).map_err(|e| e.to_string())?;
    }

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
    let session_music = "demo-chat-session-music-harmony-00001";
    conn.execute(
        "INSERT INTO chat_sessions (id, workspace_id, project_id, title, model_name, created_at, updated_at) VALUES (?1, ?2, ?3, 'How do chord progressions work?', '', ?4, ?5)",
        rusqlite::params![session_music, DEMO_WS_MUSIC, DEMO_PROJECT_MUSIC_HARMONY, now, now],
    ).map_err(|e| e.to_string())?;

    let music_msgs: Vec<(&str, &str)> = vec![
        ("user", "Can you explain how chord progressions work and why some sound more natural than others?"),
        ("assistant", "Chord progressions are sequences of chords built from the notes of a [[Major Scale]]. In any major key, each scale degree produces a chord with a specific quality:\n\n| Degree | Chord | Quality | Function |\n|--------|-------|---------|----------|\n| I | C | Major | Tonic (home) |\n| ii | Dm | Minor | Subdominant |\n| iii | Em | Minor | Tonic substitute |\n| IV | F | Major | Subdominant |\n| V | G | Major | Dominant (tension) |\n| vi | Am | Minor | Tonic substitute |\n| vii° | Bdim | Diminished | Dominant |\n\nProgressions sound natural when they follow the **circle of fifths** resolution pattern: tension (V) resolves to rest (I). The most common progression in Western music is **I → V → vi → IV** (C → G → Am → F) — it appears in hundreds of pop songs.\n\nThe reason V → I feels so satisfying is the [[Tritone]] between the 3rd and 7th of the dominant chord (B and F in G7), which resolves by half-step in opposite directions to the root and 3rd of the tonic (C and E)."),
        ("user", "What makes minor keys sound different from major keys?"),
        ("assistant", "The difference comes down to [[Intervals]] — specifically the 3rd, 6th, and 7th scale degrees:\n\n- **Major scale:** W-W-H-W-W-W-H (bright, happy)\n- **Natural minor:** W-H-W-W-H-W-W (darker, melancholic)\n\nThe key emotional difference is the **minor 3rd** interval (3 half-steps instead of 4). This single change transforms the character of every chord built on the scale.\n\nMinor keys also have variants:\n- **Harmonic minor** — raises the 7th to create a strong V → i resolution (that distinctive \"classical\" sound)\n- **Melodic minor** — raises both 6th and 7th ascending, natural descending\n\nIn practice, composers mix all three freely. A piece in A minor might use G# (harmonic) in cadences but G natural in passing melodies. The [[Circle of Fifths]] shows that every major key has a **relative minor** that shares all the same notes — C major and A minor use the same white keys."),
    ];
    for (role, content) in &music_msgs {
        let mid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![mid, session_music, role, content, now],
        ).map_err(|e| e.to_string())?;
    }

    // Concepts for Music Theory workspace
    let music_concepts: Vec<(&str, &str, &str, &str)> = vec![
        ("demo-concept-major-scale-0000000000001", "Major Scale", "The foundational seven-note scale (W-W-H-W-W-W-H) from which chords, intervals, and keys are derived.", "definition"),
        ("demo-concept-intervals-00000000000000001", "Intervals", "The distance between two pitches, measured in half-steps. Intervals determine chord quality and melodic character.", "definition"),
        ("demo-concept-circle-fifths-000000000001", "Circle of Fifths", "A visual diagram showing the relationship between the 12 chromatic pitches and their key signatures.", "topic"),
        ("demo-concept-tritone-000000000000000001", "Tritone", "An interval of three whole steps (6 half-steps), historically called diabolus in musica. Drives dominant-to-tonic resolution.", "definition"),
        ("demo-concept-cadence-000000000000000001", "Cadence", "A chord progression that signals the end of a musical phrase. Common types: authentic (V-I), plagal (IV-I), deceptive (V-vi), half (any-V).", "definition"),
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
    ];
    for (src, tgt, ltype) in &music_links {
        let lid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT OR IGNORE INTO concept_links (id, source_id, target_id, link_type, strength, context, created_at) VALUES (?1, ?2, ?3, ?4, 0.8, '', ?5)",
            rusqlite::params![lid, src, tgt, ltype, now],
        ).map_err(|e| e.to_string())?;
    }

    // Flashcards for Music Theory workspace
    let music_cards: Vec<(&str, &str)> = vec![
        ("What interval is a tritone?", "Three whole steps (6 half-steps) — e.g. C to F#. It divides the octave exactly in half and creates the tension that drives V-I resolution."),
        ("What are the chord qualities in a major key (I through vii)?", "I=Major, ii=minor, iii=minor, IV=Major, V=Major, vi=minor, vii°=diminished."),
        ("What is a perfect cadence?", "V → I (or V7 → I). The strongest resolution in tonal music, signaling the definitive end of a phrase."),
        ("What is the relative minor of C major?", "A minor — it shares all the same notes (white keys) but starts on A, giving it a different tonal center and character."),
    ];
    for (front, back) in &music_cards {
        let cid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO learning_cards (id, workspace_id, front, back, source_type, ease_factor, interval, repetitions, next_review_date, created_at) VALUES (?1, ?2, ?3, ?4, 'ai_generated', 2.5, 1, 0, ?5, ?6)",
            rusqlite::params![cid, DEMO_WS_MUSIC, front, back, today, now],
        ).map_err(|e| e.to_string())?;
    }

    // Daily notes for Music Theory workspace (past 3 days)
    for days_ago in 0..3i64 {
        let date = (chrono::Utc::now() - chrono::Duration::days(days_ago)).format("%Y-%m-%d").to_string();
        let dnid = uuid::Uuid::new_v4().to_string();
        let content = format!("## Daily Note — {date}\n\nWorked through chord progressions in C major today. The I-V-vi-IV pattern finally clicked.\n\n- Analyzed 3 pop songs for their chord progressions\n- Reviewed flashcards on intervals and cadences\n- Added concept links between Tritone and Cadence");
        conn.execute(
            "INSERT OR IGNORE INTO daily_notes (id, workspace_id, date, content, mood, productivity, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 7, 8, ?5, ?6)",
            rusqlite::params![dnid, DEMO_WS_MUSIC, date, content, now, now],
        ).map_err(|e| e.to_string())?;
    }

    // ── Workspace 3: Roman History ──────────────────────────────────────
    conn.execute(
        "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?1, '🏛️ Roman History', ?2, ?3)",
        rusqlite::params![DEMO_WS_ROME, now, now],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO projects (id, workspace_id, name, project_description, color, icon, created_at, updated_at) VALUES (?1, ?2, 'Fall of the Republic', 'The transformation from Republic to Empire', '#FF9500', 'building.columns', ?3, ?4)",
        rusqlite::params![DEMO_PROJECT_ROME, DEMO_WS_ROME, now, now],
    ).map_err(|e| e.to_string())?;

    // Chat: Roman Republic
    let session_rome = "demo-chat-session-rome-republic-00001";
    conn.execute(
        "INSERT INTO chat_sessions (id, workspace_id, project_id, title, model_name, created_at, updated_at) VALUES (?1, ?2, ?3, 'Fall of the Roman Republic', '', ?4, ?5)",
        rusqlite::params![session_rome, DEMO_WS_ROME, DEMO_PROJECT_ROME, now, now],
    ).map_err(|e| e.to_string())?;

    let rome_msgs: Vec<(&str, &str)> = vec![
        ("user", "What caused the fall of the Roman Republic?"),
        ("assistant", "The fall of the Roman Republic was a gradual process driven by several interconnected crises:\n\n1. **Land reform conflicts** — The Gracchi brothers' attempts at reform (133–121 BC) exposed deep class tensions.\n2. **Military loyalty shift** — After Marius's army reforms, soldiers became loyal to their generals rather than the state.\n3. **Civil wars** — Sulla's march on Rome (88 BC) set the precedent for using military force in politics.\n4. **The First Triumvirate** — [[Julius Caesar]], Pompey, and Crassus formed an informal power-sharing alliance that undermined Senate authority.\n5. **Caesar's dictatorship** — After crossing the Rubicon (49 BC), Caesar's concentration of power led to his assassination in 44 BC.\n6. **Final collapse** — The Second Triumvirate and Octavian's defeat of Antony at Actium (31 BC) ended the [[Roman Republic]], replaced by the Principate under Augustus.\n\nThe Republic didn't fall in a day — it was death by a thousand cuts over roughly a century."),
        ("user", "How did Caesar's assassination actually accelerate the end of the Republic?"),
        ("assistant", "Ironically, the conspirators (the Liberatores) believed killing Caesar would restore the Republic. Instead it had the opposite effect:\n\n- **Power vacuum** — Caesar's death created chaos, not freedom. The Senate couldn't reassert control.\n- **Public outrage** — Mark Antony's funeral speech turned popular opinion against the assassins.\n- **Octavian's rise** — Caesar's adopted heir was only 18 but proved a brilliant political operator. He used Caesar's name, wealth, and veterans to build his own power base.\n- **More civil wars** — The next 13 years saw continuous warfare: Octavian vs Antony vs the assassins.\n- **Permanent autocracy** — Octavian (now Augustus) learned from Caesar's mistake: he kept republican forms while holding absolute power. The Senate still met, elections still happened — but real power was his alone.\n\nThe assassination proved that the Republic's institutions were already too hollowed out to function without a strongman."),
    ];
    for (role, content) in &rome_msgs {
        let mid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![mid, session_rome, role, content, now],
        ).map_err(|e| e.to_string())?;
    }

    // Concepts for Rome workspace
    let rome_concepts: Vec<(&str, &str, &str, &str)> = vec![
        ("demo-concept-caesar-000000000000000001", "Julius Caesar", "Roman general and statesman who played a critical role in the transformation of the Roman Republic into the Roman Empire.", "person"),
        ("demo-concept-republic-00000000000000001", "Roman Republic", "The period of ancient Roman civilization characterized by a republican form of government (509–27 BC).", "topic"),
        ("demo-concept-augustus-000000000000000001", "Augustus", "First Roman Emperor, born Octavian. Transformed the Republic into the Principate while maintaining republican facades.", "person"),
        ("demo-concept-senate-0000000000000000001", "Roman Senate", "The governing body of the Roman Republic that gradually lost power to military strongmen during the late Republic.", "custom"),
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
        ("demo-concept-augustus-000000000000000001", "demo-concept-caesar-000000000000000001", "succeeded"),
        ("demo-concept-senate-0000000000000000001", "demo-concept-republic-00000000000000001", "part_of"),
    ];
    for (src, tgt, ltype) in &rome_links {
        let lid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT OR IGNORE INTO concept_links (id, source_id, target_id, link_type, strength, context, created_at) VALUES (?1, ?2, ?3, ?4, 0.8, '', ?5)",
            rusqlite::params![lid, src, tgt, ltype, now],
        ).map_err(|e| e.to_string())?;
    }

    // Flashcards for Rome workspace
    let rome_cards: Vec<(&str, &str)> = vec![
        ("What ended the Roman Republic?", "The series of civil wars culminating in Augustus (Octavian) becoming the first Emperor in 27 BC after defeating Antony at Actium."),
        ("When did Caesar cross the Rubicon?", "49 BC — this act of bringing his army into Italy proper was an act of war against the Roman state and triggered civil war with Pompey."),
    ];
    for (front, back) in &rome_cards {
        let cid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO learning_cards (id, workspace_id, front, back, source_type, ease_factor, interval, repetitions, next_review_date, created_at) VALUES (?1, ?2, ?3, ?4, 'ai_generated', 2.5, 1, 0, ?5, ?6)",
            rusqlite::params![cid, DEMO_WS_ROME, front, back, today, now],
        ).map_err(|e| e.to_string())?;
    }

    // Daily notes for Rome workspace (past 4 days)
    for days_ago in 0..4i64 {
        let date = (chrono::Utc::now() - chrono::Duration::days(days_ago)).format("%Y-%m-%d").to_string();
        let dnid = uuid::Uuid::new_v4().to_string();
        let content = format!("## Daily Note — {date}\n\nDeep dive into late Republican politics. The parallels between institutional decay then and now are striking.\n\n- Mapped out the timeline from Gracchi to Augustus\n- Added concept links between Caesar → Republic → Senate\n- Reviewed flashcards on key dates");
        conn.execute(
            "INSERT OR IGNORE INTO daily_notes (id, workspace_id, date, content, mood, productivity, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 9, 8, ?5, ?6)",
            rusqlite::params![dnid, DEMO_WS_ROME, date, content, now, now],
        ).map_err(|e| e.to_string())?;
    }

    // Return the first workspace ID as the initially active one
    Ok(DEMO_WS_AI.to_string())
}

#[tauri::command]
pub fn deactivate_demo_mode(state: State<DbState>) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    // CASCADE deletes all demo data (projects, chats, concepts, etc.)
    for ws_id in DEMO_WORKSPACE_IDS {
        conn.execute("DELETE FROM workspaces WHERE id = ?1", rusqlite::params![ws_id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
