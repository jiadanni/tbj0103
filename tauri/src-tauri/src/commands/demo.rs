use crate::db::DbState;
use tauri::State;

/// Demo mode: seeds temporary workspaces with sample data.
/// Each workspace showcases a different subject area.
/// All demo data uses hardcoded IDs so it can be cleanly removed on deactivate.

const DEMO_WS_AI: &str = "demo-workspace-ai-ml-000000000000000";
const DEMO_WS_JPN: &str = "demo-workspace-japanese-00000000000";
const DEMO_WS_ROME: &str = "demo-workspace-rome-000000000000000";

const DEMO_WORKSPACE_IDS: [&str; 3] = [DEMO_WS_AI, DEMO_WS_JPN, DEMO_WS_ROME];

const DEMO_PROJECT_AI: &str = "demo-project-transformers-000000000000";
const DEMO_PROJECT_JPN_GRAMMAR: &str = "demo-project-jpn-grammar-00000000000";
const DEMO_PROJECT_JPN_KANJI: &str = "demo-project-jpn-kanji-0000000000000";
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

    // ── Workspace 2: Japanese Language Learning ────────────────────────
    conn.execute(
        "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?1, '🇯🇵 Japanese Language', ?2, ?3)",
        rusqlite::params![DEMO_WS_JPN, now, now],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO projects (id, workspace_id, name, project_description, color, icon, created_at, updated_at) VALUES (?1, ?2, 'Grammar (JLPT N4)', 'Core grammar patterns for JLPT N4 level', '#34C759', 'text.book.closed', ?3, ?4)",
        rusqlite::params![DEMO_PROJECT_JPN_GRAMMAR, DEMO_WS_JPN, now, now],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO projects (id, workspace_id, name, project_description, color, icon, created_at, updated_at) VALUES (?1, ?2, 'Kanji Study', 'Learning kanji readings, meanings, and stroke order', '#AF52DE', 'character', ?3, ?4)",
        rusqlite::params![DEMO_PROJECT_JPN_KANJI, DEMO_WS_JPN, now, now],
    ).map_err(|e| e.to_string())?;

    // Chat: Japanese grammar
    let session_jpn = "demo-chat-session-jpn-grammar-000001";
    conn.execute(
        "INSERT INTO chat_sessions (id, workspace_id, project_id, title, model_name, created_at, updated_at) VALUES (?1, ?2, ?3, 'て-form and its uses', '', ?4, ?5)",
        rusqlite::params![session_jpn, DEMO_WS_JPN, DEMO_PROJECT_JPN_GRAMMAR, now, now],
    ).map_err(|e| e.to_string())?;

    let jpn_msgs: Vec<(&str, &str)> = vec![
        ("user", "Can you explain the て-form (te-form) in Japanese and when to use it?"),
        ("assistant", "The **て-form** (te-form) is one of the most versatile conjugations in Japanese. It's formed differently depending on the verb group:\n\n**Group 1 (五段/godan) rules:**\n- う・つ・る → って (買う → 買って)\n- む・ぶ・ぬ → んで (読む → 読んで)\n- く → いて (書く → 書いて)\n- ぐ → いで (泳ぐ → 泳いで)\n- す → して (話す → 話して)\n\n**Group 2 (一段/ichidan):** drop る, add て (食べる → 食べて)\n\n**Irregular:** する → して, 来る → 来て\n\nKey uses include:\n1. **Connecting actions** — 朝起きて、顔を洗って、朝ごはんを食べた (I woke up, washed my face, and ate breakfast)\n2. **Requesting** — て + ください → 見てください (Please look)\n3. **Progressive** — て + いる → 食べている (I am eating)\n4. **Permission** — て + もいい → 行ってもいいですか (May I go?)\n\nSee [[Te-form]] and [[Verb Conjugation]] for the full pattern tables."),
        ("user", "What about the ている form specifically? I keep confusing ongoing actions with resultant states."),
        ("assistant", "Great question — this is a common source of confusion! [[ている Form]] has two main meanings:\n\n**1. Ongoing action (progressive):**\n- 食べている → I am eating (right now)\n- 勉強している → I am studying\n\n**2. Resultant state:**\n- 結婚している → I am married (not \"I am marrying\")\n- 知っている → I know (not \"I am knowing\")\n- 住んでいる → I live in... (state, not action)\n\n**The key distinction:** verbs that describe *instantaneous* changes (死ぬ, 結婚する, 座る) tend to express a **resultant state**, while verbs describing *durative* activities (食べる, 走る, 読む) express **ongoing actions**.\n\nA helpful test: if the action can't logically be \"in progress\" (you can't be *in the process of* dying continuously), it's probably a resultant state."),
    ];
    for (role, content) in &jpn_msgs {
        let mid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![mid, session_jpn, role, content, now],
        ).map_err(|e| e.to_string())?;
    }

    // Concepts for Japanese workspace
    let jpn_concepts: Vec<(&str, &str, &str, &str)> = vec![
        ("demo-concept-teform-000000000000000001", "Te-form", "The て conjugation — the most versatile verb form in Japanese, used for connecting clauses, requests, progressive, and permission.", "definition"),
        ("demo-concept-teiru-0000000000000000001", "ている Form", "Te-form + いる: expresses ongoing actions (progressive) or resultant states depending on verb type.", "definition"),
        ("demo-concept-verbconj-00000000000000001", "Verb Conjugation", "Japanese verbs conjugate into multiple forms (dictionary, masu, te, ta, nai, etc.) based on three groups: godan, ichidan, and irregular.", "definition"),
        ("demo-concept-kanji-n4-0000000000000001", "JLPT N4 Kanji", "Approximately 300 kanji required for the JLPT N4 level, building on the 100 kanji from N5.", "topic"),
        ("demo-concept-particles-00000000000000001", "Particles", "Function words (は, が, を, に, で, etc.) that mark grammatical relationships in Japanese sentences.", "definition"),
    ];
    for (id, name, desc, ctype) in &jpn_concepts {
        conn.execute(
            "INSERT OR IGNORE INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, '[]', '[]', '[]', 0, 0, 0, ?6, ?7)",
            rusqlite::params![id, DEMO_WS_JPN, name, desc, ctype, now, now],
        ).map_err(|e| e.to_string())?;
    }

    let jpn_links: Vec<(&str, &str, &str)> = vec![
        ("demo-concept-teform-000000000000000001", "demo-concept-verbconj-00000000000000001", "part_of"),
        ("demo-concept-teiru-0000000000000000001", "demo-concept-teform-000000000000000001", "extends"),
        ("demo-concept-particles-00000000000000001", "demo-concept-verbconj-00000000000000001", "related"),
    ];
    for (src, tgt, ltype) in &jpn_links {
        let lid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT OR IGNORE INTO concept_links (id, source_id, target_id, link_type, strength, context, created_at) VALUES (?1, ?2, ?3, ?4, 0.8, '', ?5)",
            rusqlite::params![lid, src, tgt, ltype, now],
        ).map_err(|e| e.to_string())?;
    }

    // Flashcards for Japanese workspace
    let jpn_cards: Vec<(&str, &str)> = vec![
        ("What is the te-form of 読む (yomu, to read)?", "読んで (yonde) — む ending verbs change to んで."),
        ("食べている — ongoing action or resultant state?", "Ongoing action: 'I am eating.' 食べる is a durative verb, so ている expresses an action in progress."),
        ("結婚している means…?", "'I am married' (resultant state) — not 'I am marrying.' 結婚する is instantaneous, so ている expresses the resulting state."),
        ("What particle marks the direct object?", "を (wo/o) — e.g. 本を読む (hon wo yomu, read a book)."),
    ];
    for (front, back) in &jpn_cards {
        let cid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO learning_cards (id, workspace_id, front, back, source_type, ease_factor, interval, repetitions, next_review_date, created_at) VALUES (?1, ?2, ?3, ?4, 'ai_generated', 2.5, 1, 0, ?5, ?6)",
            rusqlite::params![cid, DEMO_WS_JPN, front, back, today, now],
        ).map_err(|e| e.to_string())?;
    }

    // Daily notes for Japanese workspace (past 3 days)
    for days_ago in 0..3i64 {
        let date = (chrono::Utc::now() - chrono::Duration::days(days_ago)).format("%Y-%m-%d").to_string();
        let dnid = uuid::Uuid::new_v4().to_string();
        let content = format!("## Daily Note — {date}\n\nPracticed て-form conjugation today. Getting faster at the godan verb rules but still tripping on ぐ → いで.\n\n- Drilled 20 flashcards (vocab + kanji)\n- Chat session on ている progressive vs resultant states\n- Added concept links between Te-form → Verb Conjugation");
        conn.execute(
            "INSERT OR IGNORE INTO daily_notes (id, workspace_id, date, content, mood, productivity, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 7, 8, ?5, ?6)",
            rusqlite::params![dnid, DEMO_WS_JPN, date, content, now, now],
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
