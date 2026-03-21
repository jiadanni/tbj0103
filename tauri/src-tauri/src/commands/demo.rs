use tauri::State;
use crate::db::DbState;

/// Demo mode: seeds a temporary in-memory workspace with demo data.
/// This is implemented by inserting demo data into the real DB under a special workspace ID,
/// which gets cleaned up on deactivate.
const DEMO_WORKSPACE_ID: &str = "demo-workspace-00000000-0000-0000-0000";
const DEMO_PROJECT_ID_1: &str = "demo-project-transformers-000000000000";
const DEMO_PROJECT_ID_2: &str = "demo-project-saas-0000000000000000000";
const DEMO_PROJECT_ID_3: &str = "demo-project-rome-0000000000000000000";

#[tauri::command]
pub fn activate_demo_mode(state: State<DbState>) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();

    // Remove any previous demo data
    let _ = conn.execute("DELETE FROM workspaces WHERE id = ?1", rusqlite::params![DEMO_WORKSPACE_ID]);

    // Workspace
    conn.execute(
        "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?1, '🎭 Demo Workspace', ?2, ?3)",
        rusqlite::params![DEMO_WORKSPACE_ID, now, now],
    ).map_err(|e| e.to_string())?;

    // Project 1: Transformers
    conn.execute(
        "INSERT INTO projects (id, workspace_id, name, project_description, color, icon, created_at, updated_at) VALUES (?1, ?2, 'Transformer Architecture', 'Deep dive into attention mechanisms and transformer models', '#007AFF', 'brain', ?3, ?4)",
        rusqlite::params![DEMO_PROJECT_ID_1, DEMO_WORKSPACE_ID, now, now],
    ).map_err(|e| e.to_string())?;

    // Project 2: SaaS
    conn.execute(
        "INSERT INTO projects (id, workspace_id, name, project_description, color, icon, created_at, updated_at) VALUES (?1, ?2, 'SaaS Business Model', 'Understanding subscription economics and growth metrics', '#34C759', 'chart.bar', ?3, ?4)",
        rusqlite::params![DEMO_PROJECT_ID_2, DEMO_WORKSPACE_ID, now, now],
    ).map_err(|e| e.to_string())?;

    // Project 3: Roman History
    conn.execute(
        "INSERT INTO projects (id, workspace_id, name, project_description, color, icon, created_at, updated_at) VALUES (?1, ?2, 'Roman History', 'The rise and fall of the Roman Empire', '#FF9500', 'building.columns', ?3, ?4)",
        rusqlite::params![DEMO_PROJECT_ID_3, DEMO_WORKSPACE_ID, now, now],
    ).map_err(|e| e.to_string())?;

    // Demo chat sessions
    let session1_id = "demo-chat-session-transformers-00001";
    conn.execute(
        "INSERT INTO chat_sessions (id, project_id, title, model_name, created_at, updated_at) VALUES (?1, ?2, 'What is Self-Attention?', '', ?3, ?4)",
        rusqlite::params![session1_id, DEMO_PROJECT_ID_1, now, now],
    ).map_err(|e| e.to_string())?;

    let msgs: Vec<(&str, &str, &str)> = vec![
        (session1_id, "user", "Can you explain how self-attention works in transformers?"),
        (session1_id, "assistant", "Self-attention allows each token in a sequence to attend to every other token, computing relevance scores (called attention weights). \n\nFor each token, we compute three vectors: **Query (Q)**, **Key (K)**, and **Value (V)**. The attention score between token i and token j is computed as:\n\n```\nAttention(Q,K,V) = softmax(QK^T / √d_k) × V\n```\n\nThe scaling factor `√d_k` prevents vanishing gradients in longer sequences. This mechanism is what allows transformers to capture long-range dependencies that RNNs struggled with. See [[Attention Mechanism]] and [[Query Key Value]] for more depth."),
        (session1_id, "user", "How does multi-head attention differ?"),
        (session1_id, "assistant", "[[Multi-Head Attention]] runs multiple attention operations in parallel — typically 8 or 16 heads — each with different learned projections. Each head can specialize: one might focus on syntactic relationships, another on semantic similarity.\n\nThe outputs of all heads are concatenated and projected back to the model dimension:\n\n```\nMultiHead(Q,K,V) = Concat(head₁,...,headₕ)W^O\n```\n\nThis dramatically increases the model's representational power without multiplying compute proportionally."),
    ];

    for (sid, role, content) in msgs {
        let mid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![mid, sid, role, content, now],
        ).map_err(|e| e.to_string())?;
    }

    // Demo concepts
    let concepts: Vec<(&str, &str, &str, &str)> = vec![
        ("demo-concept-attention-0000000000001", "Attention Mechanism", "The core mechanism in transformers that computes weighted relevance between sequence elements.", "technology"),
        ("demo-concept-transformer-000000000001", "Transformer", "A neural network architecture based entirely on attention mechanisms, without recurrence.", "technology"),
        ("demo-concept-qkv-00000000000000000001", "Query Key Value", "The three projection matrices used in attention: Q (what to look for), K (what to match), V (what to retrieve).", "definition"),
        ("demo-concept-mlh-00000000000000000001", "Multi-Head Attention", "Running multiple attention operations in parallel with different learned projections.", "technology"),
        ("demo-concept-mrr-00000000000000000001", "MRR (Monthly Recurring Revenue)", "The normalized monthly revenue from subscriptions, a key SaaS health metric.", "definition"),
        ("demo-concept-churn-0000000000000000001", "Churn Rate", "The percentage of customers who cancel their subscriptions in a given period.", "definition"),
        ("demo-concept-caesar-000000000000000001", "Julius Caesar", "Roman general and statesman who played a critical role in the transformation of the Roman Republic into the Roman Empire.", "person"),
        ("demo-concept-republic-00000000000000001", "Roman Republic", "The period of ancient Roman civilization characterized by a republican form of government (509–27 BC).", "topic"),
    ];

    for (id, name, desc, ctype) in &concepts {
        conn.execute(
            "INSERT OR IGNORE INTO concept_nodes (id, workspace_id, name, concept_description, concept_type, tags, aliases, references_json, x_position, y_position, review_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, '[]', '[]', '[]', 0, 0, 0, ?6, ?7)",
            rusqlite::params![id, DEMO_WORKSPACE_ID, name, desc, ctype, now, now],
        ).map_err(|e| e.to_string())?;
    }

    // Concept links
    let links: Vec<(&str, &str, &str)> = vec![
        ("demo-concept-attention-0000000000001", "demo-concept-transformer-000000000001", "supports"),
        ("demo-concept-qkv-00000000000000000001", "demo-concept-attention-0000000000001", "part_of"),
        ("demo-concept-mlh-00000000000000000001", "demo-concept-attention-0000000000001", "related"),
        ("demo-concept-caesar-000000000000000001", "demo-concept-republic-00000000000000001", "related"),
    ];
    for (src, tgt, ltype) in links {
        let lid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT OR IGNORE INTO concept_links (id, source_id, target_id, link_type, strength, context, created_at) VALUES (?1, ?2, ?3, ?4, 0.8, '', ?5)",
            rusqlite::params![lid, src, tgt, ltype, now],
        ).map_err(|e| e.to_string())?;
    }

    // Demo flashcards
    let cards: Vec<(&str, &str)> = vec![
        ("What does Q, K, V stand for in attention?", "Query, Key, Value — Q is what you're looking for, K is what available items advertise, V is what you actually retrieve."),
        ("What is the scaling factor in attention and why?", "√d_k — prevents the dot products from growing too large in high-dimensional spaces, which would push the softmax into regions with tiny gradients."),
        ("What is MRR?", "Monthly Recurring Revenue: the predictable monthly revenue from all active subscriptions."),
        ("What ended the Roman Republic?", "The series of civil wars culminating in Augustus Caesar becoming the first Emperor in 27 BC."),
    ];
    for (front, back) in cards {
        let cid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO learning_cards (id, project_id, front, back, source_type, ease_factor, interval, repetitions, next_review_date, created_at) VALUES (?1, ?2, ?3, ?4, 'ai_generated', 2.5, 1, 0, ?5, ?6)",
            rusqlite::params![cid, DEMO_PROJECT_ID_1, front, back, today, now],
        ).map_err(|e| e.to_string())?;
    }

    // Daily notes for the past 7 days
    for days_ago in 0..7i64 {
        let date = (chrono::Utc::now() - chrono::Duration::days(days_ago)).format("%Y-%m-%d").to_string();
        let dnid = uuid::Uuid::new_v4().to_string();
        let content = format!("## Daily Note — {date}\n\nLearned about transformer architectures today. Key insight: attention is all you need.\n\n- Read 2 papers\n- Reviewed flashcards\n- Created 3 new concept links");
        conn.execute(
            "INSERT OR IGNORE INTO daily_notes (id, workspace_id, date, content, mood, productivity, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 8, 7, ?5, ?6)",
            rusqlite::params![dnid, DEMO_WORKSPACE_ID, date, content, now, now],
        ).map_err(|e| e.to_string())?;
    }

    Ok(DEMO_WORKSPACE_ID.to_string())
}

#[tauri::command]
pub fn deactivate_demo_mode(state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    // CASCADE deletes all demo data (projects, chats, concepts, etc.)
    conn.execute("DELETE FROM workspaces WHERE id = ?1", rusqlite::params![DEMO_WORKSPACE_ID])
        .map_err(|e| e.to_string())?;
    Ok(())
}
