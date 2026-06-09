use rusqlite::Connection;

fn parse_setting_string(raw: String) -> String {
    serde_json::from_str::<String>(&raw).unwrap_or(raw)
}

pub fn get_string_setting(conn: &Connection, key: &str) -> Option<String> {
    let raw: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params![key],
            |row| row.get(0),
        )
        .ok()?;
    let value = parse_setting_string(raw).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

pub fn get_ollama_base_url(conn: &Connection) -> Option<String> {
    get_string_setting(conn, "ollama_base_url")
}

pub fn get_configured_background_model(conn: &Connection) -> Option<String> {
    get_string_setting(conn, "background_model").or_else(|| get_configured_chat_model(conn))
}

/// Resolve the model to use for a given background job.
///
/// Resolution order: per-job override → background model → first enabled chat
/// model → `preferred_model`. Returns `None` if no model can be resolved.
pub fn get_model_for_job(conn: &Connection, job_key: &str) -> Option<String> {
    get_string_setting(conn, job_key).or_else(|| get_configured_background_model(conn))
}

pub fn get_configured_chat_model(conn: &Connection) -> Option<String> {
    let enabled_model = conn
        .query_row(
            "SELECT model_id FROM ai_models WHERE enabled = 1 ORDER BY priority ASC LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    enabled_model.or_else(|| get_string_setting(conn, "preferred_model"))
}

pub fn get_embedding_model(conn: &Connection) -> Option<String> {
    get_string_setting(conn, "embedding_model")
}

/// Run-mode for a background job. `Auto` matches legacy behavior — job runs on
/// its scheduled tick with the per-job model. `ConfirmOnly` defers the job
/// until the user clicks the play button in the status bar; on timeout the
/// job is skipped. `DualModel` defers the job and, on timeout, runs it with
/// the per-job (small) model — confirming runs it with the heavy model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunMode {
    Auto,
    ConfirmOnly,
    DualModel,
    Disabled,
}

impl RunMode {
    pub fn as_str(self) -> &'static str {
        match self {
            RunMode::Auto => "auto",
            RunMode::ConfirmOnly => "confirm_only",
            RunMode::DualModel => "dual_model",
            RunMode::Disabled => "disabled",
        }
    }
}

pub fn get_run_mode(conn: &Connection, job_key: &str) -> RunMode {
    let key = format!("{}_run_mode", job_key);
    match get_string_setting(conn, &key).as_deref() {
        Some("confirm_only") => RunMode::ConfirmOnly,
        Some("dual_model") => RunMode::DualModel,
        Some("disabled") => RunMode::Disabled,
        _ => RunMode::Auto,
    }
}

pub fn get_heavy_model(conn: &Connection, job_key: &str) -> Option<String> {
    let key = format!("{}_heavy_model", job_key);
    get_string_setting(conn, &key)
}

pub fn get_confirm_timeout_seconds(conn: &Connection) -> u64 {
    get_string_setting(conn, "background_confirm_timeout_seconds")
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(20)
}

/// Read the user's currently-active workspace from settings (written by the
/// frontend on workspace switch). The scheduler uses this to prefer active-
/// workspace work over other workspaces.
pub fn get_current_workspace_id(conn: &Connection) -> Option<String> {
    get_string_setting(conn, "current_workspace_id")
}
