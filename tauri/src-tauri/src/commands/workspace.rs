use crate::db::DbState;
use crate::commands::chat_file::{ChatCryptoState, ChatsDirState};
use crate::models::workspace::{
    CreateChildWorkspaceRequest, CreateWorkspaceRequest, UpdateWorkspaceRequest, Workspace,
};
use crate::services::workspace_service;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn create_workspace(
    app: AppHandle,
    state: State<DbState>,
    req: CreateWorkspaceRequest,
) -> Result<Workspace, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let ws = workspace_service::create(&conn, req)?;
    let _ = app.emit("workspaces-changed", ());
    Ok(ws)
}

#[tauri::command]
pub fn create_child_workspace(
    app: AppHandle,
    state: State<DbState>,
    req: CreateChildWorkspaceRequest,
) -> Result<Workspace, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let ws = workspace_service::create_child(&conn, req)?;
    let _ = app.emit("workspaces-changed", ());
    Ok(ws)
}

#[tauri::command]
pub fn list_workspaces(state: State<DbState>) -> Result<Vec<Workspace>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    workspace_service::list_all(&conn)
}

#[tauri::command]
pub fn list_root_workspaces(state: State<DbState>) -> Result<Vec<Workspace>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    workspace_service::list_root(&conn)
}

#[tauri::command]
pub fn list_child_workspaces(state: State<DbState>, parent_id: String) -> Result<Vec<Workspace>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    workspace_service::list_children(&conn, &parent_id)
}

#[tauri::command]
pub fn list_hidden_workspaces(state: State<DbState>) -> Result<Vec<Workspace>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    workspace_service::list_hidden(&conn)
}

#[tauri::command]
pub fn get_workspace(state: State<DbState>, id: String) -> Result<Option<Workspace>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    workspace_service::get(&conn, &id)
}

#[tauri::command]
pub fn hide_workspace(app: AppHandle, state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    workspace_service::hide(&conn, &id)?;
    let _ = app.emit("workspaces-changed", ());
    Ok(())
}

#[tauri::command]
pub fn unhide_workspace(app: AppHandle, state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    workspace_service::unhide(&conn, &id)?;
    let _ = app.emit("workspaces-changed", ());
    Ok(())
}

#[tauri::command]
pub fn update_workspace(
    app: AppHandle,
    state: State<DbState>,
    req: UpdateWorkspaceRequest,
    chats_dir_state: State<ChatsDirState>,
    crypto: State<ChatCryptoState>,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let pass = crypto.0.lock().map_err(|e| e.to_string())?.clone();
    workspace_service::update(&conn, req, &chats_dir_state.0, pass.as_deref())?;
    let _ = app.emit("workspaces-changed", ());
    Ok(())
}

#[tauri::command]
pub fn delete_workspace(app: AppHandle, state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    workspace_service::delete(&conn, &id)?;
    let _ = app.emit("workspaces-changed", ());
    Ok(())
}

#[tauri::command]
pub fn set_workspace_parent(
    app: AppHandle,
    state: State<DbState>,
    id: String,
    parent_id: Option<String>,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    workspace_service::set_parent(&conn, &id, parent_id)?;
    let _ = app.emit("workspaces-changed", ());
    Ok(())
}

#[tauri::command]
pub fn update_workspace_icon(
    app: AppHandle,
    state: State<DbState>,
    id: String,
    icon: String,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    workspace_service::update_icon(&conn, &id, &icon)?;
    let _ = app.emit("workspaces-changed", ());
    Ok(())
}

#[tauri::command]
pub fn reorder_workspaces(
    app: AppHandle,
    state: State<DbState>,
    ids: Vec<String>,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    workspace_service::reorder(&conn, ids)?;
    let _ = app.emit("workspaces-changed", ());
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
        let handle = app.handle().clone();

        let req = CreateWorkspaceRequest {
            name: "Test Workspace".to_string(),
            description: Some("A test description".to_string()),
        };

        // Test create
        let ws = create_workspace(handle, state.clone(), req).expect("Failed to create workspace");
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
        let handle = app.handle().clone();

        let req = CreateWorkspaceRequest {
            name: "Hidden Test Workspace".to_string(),
            description: None,
        };
        let ws = create_workspace(handle.clone(), state.clone(), req).unwrap();

        // Initial state is not hidden
        assert_eq!(list_workspaces(state.clone()).unwrap().len(), 1);
        assert_eq!(list_hidden_workspaces(state.clone()).unwrap().len(), 0);

        // Hide it
        hide_workspace(handle.clone(), state.clone(), ws.id.clone()).unwrap();
        assert_eq!(list_workspaces(state.clone()).unwrap().len(), 0);
        assert_eq!(list_hidden_workspaces(state.clone()).unwrap().len(), 1);

        // Unhide it
        unhide_workspace(handle.clone(), state.clone(), ws.id.clone()).unwrap();
        assert_eq!(list_workspaces(state.clone()).unwrap().len(), 1);
        assert_eq!(list_hidden_workspaces(state.clone()).unwrap().len(), 0);
    }
}
