use crate::commands::chat_file::{ChatCryptoState, ChatsDirState};
use crate::db::DbState;
use crate::models::workspace::{
    CreateChildWorkspaceRequest, CreateWorkspaceRequest, UpdateWorkspaceRequest, Workspace,
};
use crate::services::background_scheduler::BackgroundTaskEvent;
use crate::services::workspace_service;
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::sync::Mutex as AsyncMutex;

static ICON_JOB_LOCK: AsyncMutex<()> = AsyncMutex::const_new(());

fn emit_icon_task<R: Runtime>(
    app: &AppHandle<R>,
    status: &str,
    message: &str,
    workspace_id: Option<String>,
    model: Option<String>,
) {
    let _ = app.emit(
        "background-task",
        BackgroundTaskEvent {
            task_type: "workspace_icon".to_string(),
            status: status.to_string(),
            message: message.to_string(),
            model,
            workspace_id,
            current: None,
            total: None,
            current_task_type: None,
        },
    );
}

#[tauri::command]
pub fn create_workspace<R: Runtime>(
    app: AppHandle<R>,
    state: State<DbState>,
    req: CreateWorkspaceRequest,
) -> Result<Workspace, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let ws = workspace_service::create(&conn, req)?;
    let _ = app.emit("workspaces-changed", ());
    Ok(ws)
}

#[tauri::command]
pub fn create_child_workspace<R: Runtime>(
    app: AppHandle<R>,
    state: State<DbState>,
    req: CreateChildWorkspaceRequest,
) -> Result<Workspace, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let ws = workspace_service::create_child(&conn, req)?;
    let _ = app.emit("workspaces-changed", ());
    Ok(ws)
}

#[tauri::command]
pub async fn list_workspaces(state: State<'_, DbState>) -> Result<Vec<Workspace>, String> {
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || -> Result<Vec<Workspace>, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        workspace_service::list_all(&conn)
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))?
}

#[tauri::command]
pub async fn list_root_workspaces(state: State<'_, DbState>) -> Result<Vec<Workspace>, String> {
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || -> Result<Vec<Workspace>, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        workspace_service::list_root(&conn)
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))?
}

#[tauri::command]
pub async fn list_child_workspaces(
    state: State<'_, DbState>,
    parent_id: String,
) -> Result<Vec<Workspace>, String> {
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || -> Result<Vec<Workspace>, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        workspace_service::list_children(&conn, &parent_id)
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))?
}

#[tauri::command]
pub async fn list_hidden_workspaces(state: State<'_, DbState>) -> Result<Vec<Workspace>, String> {
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || -> Result<Vec<Workspace>, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        workspace_service::list_hidden(&conn)
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))?
}

#[tauri::command]
pub async fn get_workspace(
    state: State<'_, DbState>,
    id: String,
) -> Result<Option<Workspace>, String> {
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || -> Result<Option<Workspace>, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        workspace_service::get(&conn, &id)
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))?
}

#[tauri::command]
pub fn hide_workspace<R: Runtime>(
    app: AppHandle<R>,
    state: State<DbState>,
    id: String,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    workspace_service::hide(&conn, &id)?;
    let _ = app.emit("workspaces-changed", ());
    Ok(())
}

#[tauri::command]
pub fn unhide_workspace<R: Runtime>(
    app: AppHandle<R>,
    state: State<DbState>,
    id: String,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    workspace_service::unhide(&conn, &id)?;
    let _ = app.emit("workspaces-changed", ());
    Ok(())
}

#[tauri::command]
pub fn update_workspace<R: Runtime>(
    app: AppHandle<R>,
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
pub fn delete_workspace<R: Runtime>(
    app: AppHandle<R>,
    state: State<DbState>,
    id: String,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    workspace_service::delete(&conn, &id)?;
    let _ = app.emit("workspaces-changed", ());
    Ok(())
}

#[tauri::command]
pub fn set_workspace_parent<R: Runtime>(
    app: AppHandle<R>,
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
pub fn update_workspace_icon<R: Runtime>(
    app: AppHandle<R>,
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
pub fn reorder_workspaces<R: Runtime>(
    app: AppHandle<R>,
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
    state: State<'_, DbState>,
    workspace_name: String,
    workspace_description: String,
) -> Result<String, String> {
    use crate::services::model_settings::{get_configured_background_model, get_ollama_base_url};
    use std::time::Duration;
    use tokio::time::timeout;

    let (model, ollama_url) = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        (
            get_configured_background_model(&conn)
                .ok_or_else(|| "No background model configured".to_string())?,
            get_ollama_base_url(&conn).unwrap_or_else(|| "http://localhost:11434".to_string()),
        )
    };

    // Try AI recommendation first (2 second timeout)
    let ai_result = timeout(
        Duration::from_secs(2),
        try_ai_icon_recommendation(&model, &ollama_url, &workspace_name, &workspace_description),
    )
    .await;

    if let Ok(Ok(icon)) = ai_result {
        return Ok(icon);
    }

    // Fall back to keyword-based recommendation
    Ok(fallback_icon_recommendation(
        &workspace_name,
        &workspace_description,
    ))
}

async fn try_ai_icon_recommendation(
    model: &str,
    ollama_url: &str,
    workspace_name: &str,
    workspace_description: &str,
) -> Result<String, String> {
    use crate::ollama::client::{OllamaClient, OllamaMessage};

    let client = OllamaClient::new(Some(ollama_url.to_string()))?;
    let prompt = format!(
        "Workspace: {} - {}. Recommend ONE lucide-react icon name only. Examples: code, brain, palette, book-open, terminal, briefcase. Just the icon name.",
        workspace_name, workspace_description
    );

    let messages = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];

    let response = client
        .send_message("workspace_icon", model, messages)
        .await?;

    let icon_name = response
        .split_whitespace()
        .next()
        .unwrap_or("folder")
        .trim_matches(|c: char| !c.is_alphanumeric() && c != '-')
        .to_lowercase();

    if !icon_name.is_empty()
        && icon_name.len() <= 30
        && icon_name.chars().all(|c| c.is_alphanumeric() || c == '-')
    {
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

    if contains_any(&[
        "python",
        "code",
        "programming",
        "dev",
        "javascript",
        "typescript",
        "rust",
        "golang",
        " js ",
        " ts ",
        "java",
        "kotlin",
    ]) {
        return "code".to_string();
    }
    if contains_any(&[
        "learn",
        "education",
        "study",
        "course",
        "tutorial",
        "training",
        "book",
    ]) {
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
    if contains_any(&[
        "design", "art", "creative", "visual", " ui ", " ux ", "graphics",
    ]) {
        return "palette".to_string();
    }
    if contains_any(&["data", "database", "sql", "analytics", "bigdata"]) {
        return "database".to_string();
    }
    if contains_any(&[
        "web", "website", "frontend", "backend", "api", "rest", "http",
    ]) {
        return "globe".to_string();
    }
    if contains_any(&[
        "system",
        "devops",
        "docker",
        "container",
        "kubernetes",
        "infra",
    ]) {
        return "zap".to_string();
    }
    if contains_any(&[
        " ml ",
        " ai ",
        "machine learning",
        "machinelearning",
        "neural",
        "deep learning",
        "deeplearning",
        "nlp",
        "gpt",
    ]) {
        return "brain".to_string();
    }
    if contains_any(&["linux", "bash", "shell", "terminal", "cli", "command"]) {
        return "terminal".to_string();
    }
    if contains_any(&["math", "engineering", "physics", "science", "equation"]) {
        return "square-root".to_string();
    }
    if contains_any(&[
        "write",
        "blog",
        "article",
        "content",
        "documentation",
        "wiki",
    ]) {
        return "pen".to_string();
    }

    "folder".to_string()
}

#[tauri::command]
pub async fn generate_workspace_icon<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DbState>,
    workspace_id: String,
) -> Result<(), String> {
    use crate::services::model_settings::{get_configured_background_model, get_ollama_base_url};
    use std::time::Duration;
    use tokio::time::timeout;

    // Read inputs we need before spawning, so we don't hold a DB conn across awaits.
    let (name, description, model, ollama_url) = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let ws = workspace_service::get(&conn, &workspace_id)?
            .ok_or_else(|| "Workspace not found".to_string())?;
        let model = get_configured_background_model(&conn);
        let url =
            get_ollama_base_url(&conn).unwrap_or_else(|| "http://localhost:11434".to_string());
        (ws.name, ws.description, model, url)
    };

    // Serialize so we never hit Ollama with parallel icon jobs (one workspace at a time).
    let _permit = ICON_JOB_LOCK.lock().await;

    emit_icon_task(
        &app,
        "started",
        &format!("Generating icon for {name}…"),
        Some(workspace_id.clone()),
        model.clone(),
    );

    let icon = if let Some(model_name) = model.as_ref() {
        let ai = timeout(
            Duration::from_secs(5),
            try_ai_icon_recommendation(model_name, &ollama_url, &name, &description),
        )
        .await;
        match ai {
            Ok(Ok(icon)) => icon,
            _ => fallback_icon_recommendation(&name, &description),
        }
    } else {
        fallback_icon_recommendation(&name, &description)
    };

    let persist = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        workspace_service::update_icon(&conn, &workspace_id, &icon)
    };

    match persist {
        Ok(()) => {
            let _ = app.emit("workspaces-changed", ());
            emit_icon_task(
                &app,
                "completed",
                &format!("Set icon to {icon}"),
                Some(workspace_id),
                model,
            );
            Ok(())
        }
        Err(e) => {
            emit_icon_task(
                &app,
                "failed",
                &format!("Icon update failed: {e}"),
                Some(workspace_id),
                model,
            );
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn generate_workspace_prompts(
    state: State<'_, DbState>,
    workspace_id: String,
    workspace_name: String,
    survey_data: Option<String>,
) -> Result<Vec<String>, String> {
    use crate::models::workspace::TopicSignature;
    use crate::ollama::client::{OllamaClient, OllamaMessage, RequestContext};
    use crate::services::model_settings::{get_configured_background_model, get_ollama_base_url};
    use std::time::Duration;

    let (model, ollama_url) = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        (
            get_configured_background_model(&conn)
                .ok_or_else(|| "No background model configured".to_string())?,
            get_ollama_base_url(&conn).unwrap_or_else(|| "http://localhost:11434".to_string()),
        )
    };

    let client = OllamaClient::new(Some(ollama_url))?;

    let mut prompt = format!(
        "Generate 4 short, natural starting questions a user might ask an AI about the topic '{}'. ",
        workspace_name
    );
    if let Some(survey) = survey_data {
        prompt.push_str(&format!(
            "Here is some context about the user's goals: {}. ",
            survey
        ));
    }
    prompt.push_str("Return ONLY a JSON array of strings containing the questions. Do not include markdown formatting or explanations.");

    let messages = vec![OllamaMessage {
        role: "user".to_string(),
        content: prompt,
    }];

    let ctx = RequestContext {
        source: Some("workspace_prompts"),
        timeout_override: Some(Duration::from_secs(15)),
        ..Default::default()
    };

    let response = client
        .send_message_with_options_observed(&model, messages, Some("0s"), &ctx)
        .await?;

    // Extract JSON array
    let json_str = if let (Some(start), Some(end)) = (response.find('['), response.rfind(']')) {
        if end > start {
            &response[start..=end]
        } else {
            &response
        }
    } else {
        &response
    };

    let prompts: Vec<String> =
        serde_json::from_str(json_str).map_err(|_| "Failed to parse AI response".to_string())?;
    let prompts: Vec<String> = prompts.into_iter().take(4).collect();

    // Save to database
    let conn = state.0.get().map_err(|e| e.to_string())?;

    let existing_json: String = conn
        .query_row(
            "SELECT topic_signature FROM workspaces WHERE id = ?1",
            rusqlite::params![workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let mut sig: TopicSignature = serde_json::from_str(&existing_json).unwrap_or_default();
    sig.suggested_prompts = prompts.clone();

    let now = chrono::Utc::now().to_rfc3339();
    let sig_json = serde_json::to_string(&sig).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE workspaces SET topic_signature = ?1, signature_updated_at = ?2 WHERE id = ?3",
        rusqlite::params![sig_json, now, workspace_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(prompts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_utils::tests::setup_test_db;
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tauri::Manager;

    #[tokio::test]
    async fn test_create_and_list_workspace() {
        let db = setup_test_db();
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
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
        let workspaces = list_workspaces(state.clone())
            .await
            .expect("Failed to list workspaces");
        assert_eq!(workspaces.len(), 1);
        assert_eq!(workspaces[0].name, "Test Workspace");
    }

    #[tokio::test]
    async fn test_hide_unhide_workspace() {
        let db = setup_test_db();
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        app.manage(DbState(db));
        let state = app.state::<DbState>();
        let handle = app.handle().clone();

        let req = CreateWorkspaceRequest {
            name: "Hidden Test Workspace".to_string(),
            description: None,
        };
        let ws = create_workspace(handle.clone(), state.clone(), req).unwrap();

        // Initial state is not hidden
        assert_eq!(list_workspaces(state.clone()).await.unwrap().len(), 1);
        assert_eq!(
            list_hidden_workspaces(state.clone()).await.unwrap().len(),
            0
        );

        // Hide it
        hide_workspace(handle.clone(), state.clone(), ws.id.clone()).unwrap();
        assert_eq!(list_workspaces(state.clone()).await.unwrap().len(), 0);
        assert_eq!(
            list_hidden_workspaces(state.clone()).await.unwrap().len(),
            1
        );

        // Unhide it
        unhide_workspace(handle.clone(), state.clone(), ws.id.clone()).unwrap();
        assert_eq!(list_workspaces(state.clone()).await.unwrap().len(), 1);
        assert_eq!(
            list_hidden_workspaces(state.clone()).await.unwrap().len(),
            0
        );
    }
}
