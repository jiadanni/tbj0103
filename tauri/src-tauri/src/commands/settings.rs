use tauri::State;
use serde::{Deserialize, Serialize};
use crate::db::DbState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub preferred_model: String,
    pub backup_enabled: bool,
    pub touch_id_enabled: bool,
    pub auto_lock_minutes: i64,
    pub theme: String,
    pub accent_color: String,
    pub font_size: i64,
    pub sidebar_width: i64,
    pub ollama_base_url: String,
    pub embedding_model: String,
    pub chat_title_auto_refresh: String,
    pub chat_title_refresh_interval: i64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            preferred_model: "qwen2.5:7b".to_string(),
            backup_enabled: true,
            touch_id_enabled: false,
            auto_lock_minutes: 15,
            theme: "system".to_string(),
            accent_color: "#007AFF".to_string(),
            font_size: 14,
            sidebar_width: 240,
            ollama_base_url: "http://localhost:11434".to_string(),
            embedding_model: "nomic-embed-text".to_string(),
            chat_title_auto_refresh: "initial_only".to_string(),
            chat_title_refresh_interval: 5,
        }
    }
}

fn get_setting(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", rusqlite::params![key], |r| r.get(0)).ok()
}

fn set_setting(conn: &rusqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_settings(state: State<DbState>) -> Result<Settings, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let def = Settings::default();
    Ok(Settings {
        preferred_model: get_setting(&conn, "preferred_model")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.preferred_model),
        backup_enabled: get_setting(&conn, "backup_enabled")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.backup_enabled),
        touch_id_enabled: get_setting(&conn, "touch_id_enabled")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.touch_id_enabled),
        auto_lock_minutes: get_setting(&conn, "auto_lock_minutes")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.auto_lock_minutes),
        theme: get_setting(&conn, "theme")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.theme),
        accent_color: get_setting(&conn, "accent_color")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.accent_color),
        font_size: get_setting(&conn, "font_size")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.font_size),
        sidebar_width: get_setting(&conn, "sidebar_width")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.sidebar_width),
        ollama_base_url: get_setting(&conn, "ollama_base_url")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.ollama_base_url),
        embedding_model: get_setting(&conn, "embedding_model")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.embedding_model),
        chat_title_auto_refresh: get_setting(&conn, "chat_title_auto_refresh")
            .unwrap_or(def.chat_title_auto_refresh),
        chat_title_refresh_interval: get_setting(&conn, "chat_title_refresh_interval")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.chat_title_refresh_interval),
    })
}

#[tauri::command]
pub fn update_settings(state: State<DbState>, settings: Settings) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    set_setting(&conn, "preferred_model", &serde_json::to_string(&settings.preferred_model).unwrap())?;
    set_setting(&conn, "backup_enabled", &settings.backup_enabled.to_string())?;
    set_setting(&conn, "touch_id_enabled", &settings.touch_id_enabled.to_string())?;
    set_setting(&conn, "auto_lock_minutes", &settings.auto_lock_minutes.to_string())?;
    set_setting(&conn, "theme", &serde_json::to_string(&settings.theme).unwrap())?;
    set_setting(&conn, "accent_color", &serde_json::to_string(&settings.accent_color).unwrap())?;
    set_setting(&conn, "font_size", &settings.font_size.to_string())?;
    set_setting(&conn, "sidebar_width", &settings.sidebar_width.to_string())?;
    set_setting(&conn, "ollama_base_url", &serde_json::to_string(&settings.ollama_base_url).unwrap())?;
    set_setting(&conn, "embedding_model", &serde_json::to_string(&settings.embedding_model).unwrap())?;
    set_setting(&conn, "chat_title_auto_refresh", &settings.chat_title_auto_refresh)?;
    set_setting(&conn, "chat_title_refresh_interval", &settings.chat_title_refresh_interval.to_string())?;
    Ok(())
}
