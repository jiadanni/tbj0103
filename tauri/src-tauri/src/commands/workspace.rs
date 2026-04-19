use crate::db::DbState;
use crate::models::workspace::{CreateChildWorkspaceRequest, CreateWorkspaceRequest, UpdateWorkspaceRequest, Workspace};
use crate::services::chat_file_store;
use crate::commands::chat_file::{ChatCryptoState, ChatsDirState};
use tauri::State;

#[tauri::command]
pub fn create_workspace(
    state: State<DbState>,
    req: CreateWorkspaceRequest,
) -> Result<Workspace, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let ws = Workspace::new(req.name, req.description.unwrap_or_default());

    let sig_json = serde_json::to_string(&ws.topic_signature).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO workspaces (id, name, description, prompt_instructions, topic_signature, signature_updated_at, is_hidden, created_at, updated_at, parent_workspace_id, icon) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        rusqlite::params![ws.id, ws.name, ws.description, ws.prompt_instructions, sig_json, ws.signature_updated_at, ws.is_hidden as i64, ws.created_at, ws.updated_at, ws.parent_workspace_id, ws.icon],
    ).map_err(|e| e.to_string())?;
    Ok(ws)
}

#[tauri::command]
pub fn create_child_workspace(
    state: State<DbState>,
    req: CreateChildWorkspaceRequest,
) -> Result<Workspace, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut ws = Workspace::new(req.name, req.description.unwrap_or_default());
    ws.parent_workspace_id = Some(req.parent_id);
    let sig_json = serde_json::to_string(&ws.topic_signature).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO workspaces (id, name, description, prompt_instructions, topic_signature, signature_updated_at, is_hidden, created_at, updated_at, parent_workspace_id, icon) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        rusqlite::params![ws.id, ws.name, ws.description, ws.prompt_instructions, sig_json, ws.signature_updated_at, ws.is_hidden as i64, ws.created_at, ws.updated_at, ws.parent_workspace_id, ws.icon],
    ).map_err(|e| e.to_string())?;
    Ok(ws)
}

#[tauri::command]
pub fn list_workspaces(state: State<DbState>) -> Result<Vec<Workspace>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, name, description, prompt_instructions, topic_signature, signature_updated_at, is_hidden, created_at, updated_at, parent_workspace_id, icon
         FROM workspaces
         WHERE is_hidden = 0
         ORDER BY name COLLATE NOCASE ASC, created_at ASC, id ASC"
    ).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map([], |row| {
            let sig_json: String = row.get(4)?;
            let topic_signature = serde_json::from_str(&sig_json).unwrap_or_default();
            let is_hidden: i64 = row.get(6)?;
            Ok(Workspace {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                prompt_instructions: row.get(3)?,
                topic_signature,
                signature_updated_at: row.get(5)?,
                is_hidden: is_hidden != 0,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                parent_workspace_id: row.get(9)?,
                icon: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn list_root_workspaces(state: State<DbState>) -> Result<Vec<Workspace>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, name, description, prompt_instructions, topic_signature, signature_updated_at, is_hidden, created_at, updated_at, parent_workspace_id, icon
         FROM workspaces
         WHERE is_hidden = 0 AND parent_workspace_id IS NULL
         ORDER BY name COLLATE NOCASE ASC, created_at ASC, id ASC"
    ).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map([], |row| {
            let sig_json: String = row.get(4)?;
            let topic_signature = serde_json::from_str(&sig_json).unwrap_or_default();
            let is_hidden: i64 = row.get(6)?;
            Ok(Workspace {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                prompt_instructions: row.get(3)?,
                topic_signature,
                signature_updated_at: row.get(5)?,
                is_hidden: is_hidden != 0,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                parent_workspace_id: row.get(9)?,
                icon: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn list_child_workspaces(state: State<DbState>, parent_id: String) -> Result<Vec<Workspace>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, name, description, prompt_instructions, topic_signature, signature_updated_at, is_hidden, created_at, updated_at, parent_workspace_id, icon
         FROM workspaces
         WHERE is_hidden = 0 AND parent_workspace_id = ?1
         ORDER BY name COLLATE NOCASE ASC, created_at ASC, id ASC"
    ).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(rusqlite::params![parent_id], |row| {
            let sig_json: String = row.get(4)?;
            let topic_signature = serde_json::from_str(&sig_json).unwrap_or_default();
            let is_hidden: i64 = row.get(6)?;
            Ok(Workspace {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                prompt_instructions: row.get(3)?,
                topic_signature,
                signature_updated_at: row.get(5)?,
                is_hidden: is_hidden != 0,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                parent_workspace_id: row.get(9)?,
                icon: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn list_hidden_workspaces(state: State<DbState>) -> Result<Vec<Workspace>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, name, description, prompt_instructions, topic_signature, signature_updated_at, is_hidden, created_at, updated_at, parent_workspace_id, icon
         FROM workspaces
         WHERE is_hidden = 1
         ORDER BY name COLLATE NOCASE ASC, created_at ASC, id ASC"
    ).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map([], |row| {
            let sig_json: String = row.get(4)?;
            let topic_signature = serde_json::from_str(&sig_json).unwrap_or_default();
            let is_hidden: i64 = row.get(6)?;
            Ok(Workspace {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                prompt_instructions: row.get(3)?,
                topic_signature,
                signature_updated_at: row.get(5)?,
                is_hidden: is_hidden != 0,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                parent_workspace_id: row.get(9)?,
                icon: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn get_workspace(state: State<DbState>, id: String) -> Result<Option<Workspace>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT id, name, description, prompt_instructions, topic_signature, signature_updated_at, is_hidden, created_at, updated_at, parent_workspace_id, icon FROM workspaces WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            let sig_json: String = row.get(4)?;
            let topic_signature = serde_json::from_str(&sig_json).unwrap_or_default();
            let is_hidden: i64 = row.get(6)?;
            Ok(Workspace {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                prompt_instructions: row.get(3)?,
                topic_signature,
                signature_updated_at: row.get(5)?,
                is_hidden: is_hidden != 0,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                parent_workspace_id: row.get(9)?,
                icon: row.get(10)?,
            })
        },
    );
    match result {
        Ok(ws) => Ok(Some(ws)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn hide_workspace(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE workspaces SET is_hidden = 1, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn unhide_workspace(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE workspaces SET is_hidden = 0, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_workspace(
    state: State<DbState>,
    req: UpdateWorkspaceRequest,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let session_ids = if req.name.trim().is_empty() {
        Vec::new()
    } else {
        let mut stmt = conn
            .prepare("SELECT id FROM chat_sessions WHERE workspace_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![req.id.clone()], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    let previous_paths =
        chat_file_store::capture_session_file_variants(&conn, &chats_dir_state.0, &session_ids);
    let now = chrono::Utc::now().to_rfc3339();
    // Always update name and updated_at; conditionally update description and prompt_instructions
    conn.execute(
        "UPDATE workspaces SET name = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![req.name, now, req.id],
    )
    .map_err(|e| e.to_string())?;
    if let Some(description) = &req.description {
        conn.execute(
            "UPDATE workspaces SET description = ?1 WHERE id = ?2",
            rusqlite::params![description, req.id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(instructions) = &req.prompt_instructions {
        conn.execute(
            "UPDATE workspaces SET prompt_instructions = ?1 WHERE id = ?2",
            rusqlite::params![instructions, req.id],
        )
        .map_err(|e| e.to_string())?;
    }

    if !session_ids.is_empty() {
        let pass = crypto.0.lock().map_err(|e| e.to_string())?.clone();
        chat_file_store::sync_session_files_for_hierarchy_change(
            &conn,
            &chats_dir_state.0,
            &session_ids,
            &previous_paths,
            pass.as_deref(),
        )?;
    }

    Ok(())
}

#[tauri::command]
pub fn delete_workspace(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM workspaces WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_workspace_parent(
    state: State<DbState>,
    id: String,
    parent_id: Option<String>,
) -> Result<(), String> {
    if let Some(ref pid) = parent_id {
        if *pid == id {
            return Err("A workspace cannot be its own parent.".to_string());
        }
        // Prevent circular references: ensure the proposed parent is not itself a child of `id`
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let parent_of_parent: Option<String> = conn.query_row(
            "SELECT parent_workspace_id FROM workspaces WHERE id = ?1",
            rusqlite::params![pid],
            |row| row.get(0),
        ).unwrap_or(None);
        if parent_of_parent.as_deref() == Some(&id) {
            return Err("Cannot create a circular parent-child relationship.".to_string());
        }
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE workspaces SET parent_workspace_id = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![pid, now, id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE workspaces SET parent_workspace_id = NULL, updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn update_workspace_icon(
    state: State<DbState>,
    id: String,
    icon: String,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE workspaces SET icon = ?, updated_at = datetime('now') WHERE id = ?",
        rusqlite::params![icon, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn recommend_workspace_icon(
    workspace_name: String,
    workspace_description: String,
) -> Result<String, String> {
    use tokio::time::timeout;
    use std::time::Duration;
    
    // Try AI recommendation first (2 second timeout)
    let ai_result = timeout(
        Duration::from_secs(2),
        try_ai_icon_recommendation(&workspace_name, &workspace_description)
    ).await;
    
    if let Ok(Ok(icon)) = ai_result {
        return Ok(icon);
    }
    
    // Fall back to keyword-based recommendation
    Ok(fallback_icon_recommendation(&workspace_name, &workspace_description))
}

async fn try_ai_icon_recommendation(workspace_name: &str, workspace_description: &str) -> Result<String, String> {
    use crate::ollama::client::{OllamaClient, OllamaMessage};
    
    let client = OllamaClient::new(None)?;
    let prompt = format!(
        "Workspace: {} - {}. Recommend ONE lucide-react icon name only. Examples: code, brain, palette, book-open, terminal, briefcase. Just the icon name.",
        workspace_name, workspace_description
    );
    
    let messages = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];
    
    let response = client.send_message("workspace_icon", "mistral", messages).await?;
    
    let icon_name = response
        .trim()
        .split_whitespace()
        .next()
        .unwrap_or("folder")
        .trim_matches(|c: char| !c.is_alphanumeric() && c != '-')
        .to_lowercase();
    
    if !icon_name.is_empty() && icon_name.len() <= 30 && icon_name.chars().all(|c| c.is_alphanumeric() || c == '-') {
        Ok(icon_name)
    } else {
        Err("Invalid icon name".to_string())
    }
}

/// Fallback icon recommendation when Ollama is unavailable.
/// Uses simple keyword matching to suggest appropriate icons.
fn fallback_icon_recommendation(workspace_name: &str, workspace_description: &str) -> String {
    let input = format!("{} {}", workspace_name, workspace_description).to_lowercase();

    let contains_any = |keywords: &[&str]| keywords.iter().any(|kw| input.contains(kw));

    if contains_any(&["python", "code", "programming", "dev", "javascript", "typescript", "rust", "golang", " js ", " ts ", "java", "kotlin"]) {
        return "code".to_string();
    }
    if contains_any(&["learn", "education", "study", "course", "tutorial", "training", "book"]) {
        return "book-open".to_string();
    }
    if contains_any(&["security", "crypto", "privacy", "encrypt", "safe"]) {
        return "shield".to_string();
    }
    if input.contains("music") {
        return "music".to_string();
    }
    if contains_any(&["health", "medical", "fitness", "wellness", "doctor"]) {
        return "heart".to_string();
    }
    if contains_any(&["business", "work", "job", "startup", "career", "enterprise"]) {
        return "briefcase".to_string();
    }
    if contains_any(&["design", "art", "creative", "visual", " ui ", " ux ", "graphics"]) {
        return "palette".to_string();
    }
    if contains_any(&["data", "database", "sql", "analytics", "bigdata"]) {
        return "database".to_string();
    }
    if contains_any(&["web", "website", "frontend", "backend", "api", "rest", "http"]) {
        return "globe".to_string();
    }
    if contains_any(&["system", "devops", "docker", "container", "kubernetes", "infra"]) {
        return "zap".to_string();
    }
    if contains_any(&[" ml ", " ai ", "machine learning", "machinelearning", "neural", "deep learning", "deeplearning", "nlp", "gpt"]) {
        return "brain".to_string();
    }
    if contains_any(&["linux", "bash", "shell", "terminal", "cli", "command"]) {
        return "terminal".to_string();
    }
    if contains_any(&["math", "engineering", "physics", "science", "equation"]) {
        return "square-root".to_string();
    }
    if contains_any(&["write", "blog", "article", "content", "documentation", "wiki"]) {
        return "pen".to_string();
    }

    "folder".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_utils::tests::setup_test_db;
    use std::sync::Mutex;
    use tauri::test::{mock_builder, mock_context};
    use tauri::Manager;

    fn get_mock_state(
        db: r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>,
    ) -> tauri::State<'static, DbState> {
        let app = mock_builder().build(tauri::generate_context!()).unwrap();
        app.manage(DbState(db));
        // This is safe for a test environment as long as app stays alive
        // Wait, app is dropped at the end of the function, so state will be invalidated.
        // Let's just return the app handle and get state from it in each test.
        unreachable!()
    }

    #[test]
    fn test_create_and_list_workspace() {
        let db = setup_test_db();
        let app = mock_builder().build(tauri::generate_context!()).unwrap();
        app.manage(DbState(db));
        let state = app.state::<DbState>();

        let req = CreateWorkspaceRequest {
            name: "Test Workspace".to_string(),
            description: Some("A test description".to_string()),
        };

        // Test create
        let ws = create_workspace(state.clone(), req).expect("Failed to create workspace");
        assert_eq!(ws.name, "Test Workspace");
        assert_eq!(ws.description, "A test description");

        // Test list
        let workspaces = list_workspaces(state.clone()).expect("Failed to list workspaces");
        assert_eq!(workspaces.len(), 1);
        assert_eq!(workspaces[0].name, "Test Workspace");
    }

    #[test]
    fn test_hide_unhide_workspace() {
        let db = setup_test_db();
        let app = mock_builder().build(tauri::generate_context!()).unwrap();
        app.manage(DbState(db));
        let state = app.state::<DbState>();

        let req = CreateWorkspaceRequest {
            name: "Hidden Test Workspace".to_string(),
            description: None,
        };
        let ws = create_workspace(state.clone(), req).unwrap();

        // Initial state is not hidden
        assert_eq!(list_workspaces(state.clone()).unwrap().len(), 1);
        assert_eq!(list_hidden_workspaces(state.clone()).unwrap().len(), 0);

        // Hide it
        hide_workspace(state.clone(), ws.id.clone()).unwrap();
        assert_eq!(list_workspaces(state.clone()).unwrap().len(), 0);
        assert_eq!(list_hidden_workspaces(state.clone()).unwrap().len(), 1);

        // Unhide it
        unhide_workspace(state.clone(), ws.id.clone()).unwrap();
        assert_eq!(list_workspaces(state.clone()).unwrap().len(), 1);
        assert_eq!(list_hidden_workspaces(state.clone()).unwrap().len(), 0);
    }
}
