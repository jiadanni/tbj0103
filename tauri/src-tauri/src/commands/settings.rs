use crate::commands::quick_search::QuickSearchRuntimeState;
use crate::commands::security::{require_auth, AuthState};
use crate::db::DbState;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub preferred_model: String,
    pub background_model: String,
    pub quick_search_models: Vec<String>,
    pub quick_search_shortcut: String,
    pub quick_search_workspace_scope: String,
    pub quick_search_type_filters: Vec<String>,
    pub backup_enabled: bool,
    pub touch_id_enabled: bool,
    pub pin_lock_enabled: bool,
    pub auto_lock_minutes: i64,
    pub theme: String,
    pub accent_color: String,
    pub font_size: i64,
    pub sidebar_width: i64,
    pub ollama_base_url: String,
    pub auto_start_ollama: bool,
    pub mlx_base_url: String,
    pub llamacpp_model_paths: Vec<String>,
    pub embedding_model: String,
    pub chat_title_auto_refresh: String,
    pub chat_title_refresh_interval: i64,
    pub chat_json_storage: bool,
    pub chat_encryption_enabled: bool,
    pub web_session_preserve: bool,
    pub dual_model_enabled: bool,
    pub draft_model: String,
    pub dual_model_execution_mode: String,
    pub compare_model_a: String,
    pub compare_model_b: String,
    pub start_at_login: bool,
    pub open_in_background: bool,
    pub keep_running_in_tray: bool,
    pub immediate_delete: bool,
    pub confirm_move_to_trash: bool,
    pub prompt_instructions: String,
    pub switch_workspace_section: String,
    pub hide_native_menu: bool,
    pub show_gen_info: bool,
    pub show_gen_info_token_count: bool,
    pub show_gen_info_duration: bool,
    pub show_gen_info_speed: bool,
    pub show_gen_info_model: bool,
    pub demo_dismissed: bool,
    pub memory_enabled: bool,
    pub memory_extraction_threshold: u32,
    pub memory_extraction_idle_minutes: u32,
    pub topic_analysis_interval_minutes: u32,
    pub summarization_min_messages: u32,
    pub summarization_max_sessions: u32,
    pub hover_definition_scan_enabled: bool,
    pub hover_definition_scan_max_sessions: u32,
    pub workspace_glossary_refresh_interval_minutes: u32,
    pub git_sync_interval_minutes: u32,
    pub menubar_icon_style: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            preferred_model: "".to_string(),
            background_model: "".to_string(),
            quick_search_models: Vec::new(),
            quick_search_shortcut: "CmdOrCtrl+Shift+K".to_string(),
            quick_search_workspace_scope: "__all__".to_string(),
            quick_search_type_filters: vec![
                "conversation".to_string(),
                "message".to_string(),
                "artifact".to_string(),
                "memory".to_string(),
                "summary".to_string(),
            ],
            backup_enabled: true,
            touch_id_enabled: false,
            pin_lock_enabled: false,
            auto_lock_minutes: 0,
            theme: "system".to_string(),
            accent_color: "#007AFF".to_string(),
            font_size: 16,
            sidebar_width: 240,
            ollama_base_url: "http://localhost:11434".to_string(),
            auto_start_ollama: false,
            mlx_base_url: "http://localhost:8080".to_string(),
            llamacpp_model_paths: Vec::new(),
            embedding_model: "nomic-embed-text".to_string(),
            chat_title_auto_refresh: "initial_only".to_string(),
            chat_title_refresh_interval: 5,
            chat_json_storage: true,
            chat_encryption_enabled: false,
            web_session_preserve: false,
            dual_model_enabled: false,
            draft_model: "".to_string(),
            dual_model_execution_mode: "serial".to_string(),
            compare_model_a: "".to_string(),
            compare_model_b: "".to_string(),
            start_at_login: false,
            open_in_background: false,
            keep_running_in_tray: false,
            immediate_delete: false,
            confirm_move_to_trash: true,
            prompt_instructions: String::new(),
            switch_workspace_section: String::new(),
            hide_native_menu: false,
            show_gen_info: true,
            show_gen_info_token_count: true,
            show_gen_info_duration: true,
            show_gen_info_speed: true,
            show_gen_info_model: true,
            demo_dismissed: false,
            memory_enabled: true,
            memory_extraction_threshold: 5,
            memory_extraction_idle_minutes: 5,
            topic_analysis_interval_minutes: 30,
            summarization_min_messages: 10,
            summarization_max_sessions: 5,
            hover_definition_scan_enabled: true,
            hover_definition_scan_max_sessions: 3,
            workspace_glossary_refresh_interval_minutes: 60,
            git_sync_interval_minutes: 5,
            menubar_icon_style: "monochrome".to_string(),
        }
    }
}

const AUTOSTART_ARG: &str = "--autostart";

fn normalize_theme(theme: &str) -> &str {
    match theme {
        "system" | "light" | "noir" | "sepia" | "hacker" => theme,
        "dark" | "glasscode" | "oled" => "noir",
        _ => "system",
    }
}

fn biometric_available() -> bool {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        true
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

pub(crate) fn get_setting(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |r| r.get(0),
    )
    .ok()
}

fn set_setting(conn: &rusqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn is_windows_missing_autostart_target(error: &str) -> bool {
    cfg!(target_os = "windows")
        && (error.contains("(os error 2)")
            || error.contains("The system cannot find the file specified"))
}

#[tauri::command]
pub fn get_settings(app: AppHandle, state: State<DbState>) -> Result<Settings, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let def = Settings::default();
    let stored_start_at_login = get_setting(&conn, "start_at_login")
        .map(|v| v == "true")
        .unwrap_or(def.start_at_login);
    let start_at_login = match app.autolaunch().is_enabled() {
        Ok(value) => value,
        Err(err) => {
            let error = err.to_string();
            if is_windows_missing_autostart_target(&error) {
                crate::logging::log_warn(
                    "settings",
                    format!(
                        "Falling back to stored start_at_login value after autostart query failed: {error}"
                    ),
                );
                stored_start_at_login
            } else {
                return Err(error);
            }
        }
    };
    let pin_configured = get_setting(&conn, "pin_passcode_hash")
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false);
    let pin_lock_enabled = get_setting(&conn, "pin_lock_enabled")
        .and_then(|v| v.parse().ok())
        .unwrap_or(def.pin_lock_enabled)
        && pin_configured;
    let biometric_available = biometric_available();
    let stored_theme = get_setting(&conn, "theme")
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or_else(|| def.theme.clone());
    let normalized_theme = normalize_theme(&stored_theme).to_string();

    if normalized_theme != stored_theme {
        let serialized_theme =
            serde_json::to_string(&normalized_theme).map_err(|e| e.to_string())?;
        set_setting(&conn, "theme", &serialized_theme)?;
    }

    Ok(Settings {
        preferred_model: get_setting(&conn, "preferred_model")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.preferred_model),
        background_model: get_setting(&conn, "background_model")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.background_model),
        quick_search_models: get_setting(&conn, "quick_search_models")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.quick_search_models),
        quick_search_shortcut: get_setting(&conn, "quick_search_shortcut")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.quick_search_shortcut),
        quick_search_workspace_scope: get_setting(&conn, "quick_search_workspace_scope")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.quick_search_workspace_scope),
        quick_search_type_filters: get_setting(&conn, "quick_search_type_filters")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.quick_search_type_filters),
        backup_enabled: get_setting(&conn, "backup_enabled")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.backup_enabled),
        touch_id_enabled: get_setting(&conn, "touch_id_enabled")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.touch_id_enabled)
            && biometric_available
            && pin_lock_enabled,
        pin_lock_enabled,
        auto_lock_minutes: get_setting(&conn, "auto_lock_minutes")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.auto_lock_minutes),
        theme: normalized_theme,
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
        auto_start_ollama: get_setting(&conn, "auto_start_ollama")
            .map(|v| v == "true")
            .unwrap_or(def.auto_start_ollama),
        mlx_base_url: get_setting(&conn, "mlx_base_url")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.mlx_base_url),
        llamacpp_model_paths: get_setting(&conn, "llamacpp_model_paths")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.llamacpp_model_paths),
        embedding_model: get_setting(&conn, "embedding_model")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.embedding_model),
        chat_title_auto_refresh: get_setting(&conn, "chat_title_auto_refresh")
            .unwrap_or(def.chat_title_auto_refresh),
        chat_title_refresh_interval: get_setting(&conn, "chat_title_refresh_interval")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.chat_title_refresh_interval),
        chat_json_storage: get_setting(&conn, "chat_json_storage")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.chat_json_storage),
        chat_encryption_enabled: get_setting(&conn, "chat_encryption_enabled")
            .map(|v| v == "true")
            .unwrap_or(def.chat_encryption_enabled),
        web_session_preserve: get_setting(&conn, "web_session_preserve")
            .map(|v| v == "true")
            .unwrap_or(def.web_session_preserve),
        dual_model_enabled: get_setting(&conn, "dual_model_enabled")
            .map(|v| v == "true")
            .unwrap_or(def.dual_model_enabled),
        draft_model: get_setting(&conn, "draft_model")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.draft_model),
        dual_model_execution_mode: get_setting(&conn, "dual_model_execution_mode")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.dual_model_execution_mode),
        compare_model_a: get_setting(&conn, "compare_model_a")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.compare_model_a),
        compare_model_b: get_setting(&conn, "compare_model_b")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.compare_model_b),
        start_at_login,
        open_in_background: get_setting(&conn, "open_in_background")
            .map(|v| v == "true")
            .unwrap_or(def.open_in_background),
        keep_running_in_tray: get_setting(&conn, "keep_running_in_tray")
            .map(|v| v == "true")
            .unwrap_or(def.keep_running_in_tray),
        immediate_delete: get_setting(&conn, "immediate_delete")
            .map(|v| v == "true")
            .unwrap_or(def.immediate_delete),
        confirm_move_to_trash: get_setting(&conn, "confirm_move_to_trash")
            .map(|v| v == "true")
            .unwrap_or(def.confirm_move_to_trash),
        prompt_instructions: get_setting(&conn, "prompt_instructions")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.prompt_instructions),
        switch_workspace_section: get_setting(&conn, "switch_workspace_section")
            .unwrap_or_else(|| {
                // Migrate legacy boolean: true → "/chat", false → ""
                get_setting(&conn, "switch_workspace_to_chat")
                    .map(|v| if v == "true" { "/chat".to_string() } else { String::new() })
                    .unwrap_or(def.switch_workspace_section.clone())
            }),
        hide_native_menu: get_setting(&conn, "hide_native_menu")
            .map(|v| v == "true")
            .unwrap_or(def.hide_native_menu),
        show_gen_info: get_setting(&conn, "show_gen_info")
            .map(|v| v == "true")
            .unwrap_or(def.show_gen_info),
        show_gen_info_token_count: get_setting(&conn, "show_gen_info_token_count")
            .map(|v| v == "true")
            .unwrap_or(def.show_gen_info_token_count),
        show_gen_info_duration: get_setting(&conn, "show_gen_info_duration")
            .map(|v| v == "true")
            .unwrap_or(def.show_gen_info_duration),
        show_gen_info_speed: get_setting(&conn, "show_gen_info_speed")
            .map(|v| v == "true")
            .unwrap_or(def.show_gen_info_speed),
        show_gen_info_model: get_setting(&conn, "show_gen_info_model")
            .map(|v| v == "true")
            .unwrap_or(def.show_gen_info_model),
        demo_dismissed: get_setting(&conn, "demo_dismissed")
            .map(|v| v == "true")
            .unwrap_or(def.demo_dismissed),
        memory_enabled: get_setting(&conn, "memory_enabled")
            .map(|v| v == "true")
            .unwrap_or(def.memory_enabled),
        memory_extraction_threshold: get_setting(&conn, "memory_extraction_threshold")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.memory_extraction_threshold),
        memory_extraction_idle_minutes: get_setting(&conn, "memory_extraction_idle_minutes")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.memory_extraction_idle_minutes),
        topic_analysis_interval_minutes: get_setting(&conn, "topic_analysis_interval_minutes")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.topic_analysis_interval_minutes),
        summarization_min_messages: get_setting(&conn, "summarization_min_messages")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.summarization_min_messages),
        summarization_max_sessions: get_setting(&conn, "summarization_max_sessions")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.summarization_max_sessions),
        hover_definition_scan_enabled: get_setting(&conn, "hover_definition_scan_enabled")
            .map(|v| v == "true")
            .unwrap_or(def.hover_definition_scan_enabled),
        hover_definition_scan_max_sessions: get_setting(&conn, "hover_definition_scan_max_sessions")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.hover_definition_scan_max_sessions),
        workspace_glossary_refresh_interval_minutes: get_setting(&conn, "workspace_glossary_refresh_interval_minutes")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.workspace_glossary_refresh_interval_minutes),
        git_sync_interval_minutes: get_setting(&conn, "git_sync_interval_minutes")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.git_sync_interval_minutes),
        menubar_icon_style: get_setting(&conn, "menubar_icon_style")
            .unwrap_or_else(|| def.menubar_icon_style.clone()),
    })
}

#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    auth: State<AuthState>,
    state: State<DbState>,
    quick_search_state: State<QuickSearchRuntimeState>,
    settings: Settings,
) -> Result<(), String> {
    require_auth(&auth, &state)?;
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let pin_configured = get_setting(&conn, "pin_passcode_hash")
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false);
    let biometric_available = biometric_available();
    let effective_pin_lock_enabled = settings.pin_lock_enabled && pin_configured;
    let normalized_quick_search_shortcut =
        crate::commands::quick_search::normalize_shortcut(&settings.quick_search_shortcut);
    let normalized_theme = normalize_theme(&settings.theme).to_string();

    crate::commands::quick_search::apply_shortcut(
        &app,
        &quick_search_state,
        normalized_quick_search_shortcut.clone(),
    )?;

    set_setting(
        &conn,
        "preferred_model",
        &serde_json::to_string(&settings.preferred_model).unwrap(),
    )?;
    set_setting(
        &conn,
        "background_model",
        &serde_json::to_string(&settings.background_model).unwrap(),
    )?;
    set_setting(
        &conn,
        "quick_search_models",
        &serde_json::to_string(&settings.quick_search_models).unwrap(),
    )?;
    set_setting(
        &conn,
        "quick_search_shortcut",
        &serde_json::to_string(&normalized_quick_search_shortcut.unwrap_or_default()).unwrap(),
    )?;
    set_setting(
        &conn,
        "quick_search_workspace_scope",
        &serde_json::to_string(&settings.quick_search_workspace_scope).unwrap(),
    )?;
    set_setting(
        &conn,
        "quick_search_type_filters",
        &serde_json::to_string(&settings.quick_search_type_filters).unwrap(),
    )?;
    set_setting(
        &conn,
        "backup_enabled",
        &settings.backup_enabled.to_string(),
    )?;
    set_setting(
        &conn,
        "touch_id_enabled",
        &(settings.touch_id_enabled && biometric_available && effective_pin_lock_enabled)
            .to_string(),
    )?;
    set_setting(
        &conn,
        "pin_lock_enabled",
        &effective_pin_lock_enabled.to_string(),
    )?;
    set_setting(
        &conn,
        "auto_lock_minutes",
        &settings.auto_lock_minutes.to_string(),
    )?;
    set_setting(
        &conn,
        "theme",
        &serde_json::to_string(&normalized_theme).map_err(|e| e.to_string())?,
    )?;
    set_setting(
        &conn,
        "accent_color",
        &serde_json::to_string(&settings.accent_color).unwrap(),
    )?;
    set_setting(&conn, "font_size", &settings.font_size.to_string())?;
    set_setting(&conn, "sidebar_width", &settings.sidebar_width.to_string())?;
    set_setting(
        &conn,
        "ollama_base_url",
        &serde_json::to_string(&settings.ollama_base_url).unwrap(),
    )?;
    set_setting(
        &conn,
        "auto_start_ollama",
        &settings.auto_start_ollama.to_string(),
    )?;
    set_setting(
        &conn,
        "mlx_base_url",
        &serde_json::to_string(&settings.mlx_base_url).unwrap(),
    )?;
    set_setting(
        &conn,
        "llamacpp_model_paths",
        &serde_json::to_string(&settings.llamacpp_model_paths).unwrap(),
    )?;
    set_setting(
        &conn,
        "embedding_model",
        &serde_json::to_string(&settings.embedding_model).unwrap(),
    )?;
    set_setting(
        &conn,
        "chat_title_auto_refresh",
        &settings.chat_title_auto_refresh,
    )?;
    set_setting(
        &conn,
        "chat_title_refresh_interval",
        &settings.chat_title_refresh_interval.to_string(),
    )?;
    set_setting(
        &conn,
        "chat_json_storage",
        &settings.chat_json_storage.to_string(),
    )?;
    set_setting(
        &conn,
        "web_session_preserve",
        &settings.web_session_preserve.to_string(),
    )?;
    set_setting(
        &conn,
        "dual_model_enabled",
        &settings.dual_model_enabled.to_string(),
    )?;
    set_setting(
        &conn,
        "draft_model",
        &serde_json::to_string(&settings.draft_model).unwrap(),
    )?;
    set_setting(
        &conn,
        "dual_model_execution_mode",
        &serde_json::to_string(&settings.dual_model_execution_mode).unwrap(),
    )?;
    set_setting(
        &conn,
        "compare_model_a",
        &serde_json::to_string(&settings.compare_model_a).unwrap(),
    )?;
    set_setting(
        &conn,
        "compare_model_b",
        &serde_json::to_string(&settings.compare_model_b).unwrap(),
    )?;
    set_setting(
        &conn,
        "start_at_login",
        &settings.start_at_login.to_string(),
    )?;
    set_setting(
        &conn,
        "open_in_background",
        &settings.open_in_background.to_string(),
    )?;
    set_setting(
        &conn,
        "keep_running_in_tray",
        &settings.keep_running_in_tray.to_string(),
    )?;
    set_setting(
        &conn,
        "immediate_delete",
        &settings.immediate_delete.to_string(),
    )?;
    set_setting(
        &conn,
        "confirm_move_to_trash",
        &settings.confirm_move_to_trash.to_string(),
    )?;
    set_setting(
        &conn,
        "prompt_instructions",
        &serde_json::to_string(&settings.prompt_instructions).unwrap(),
    )?;
    set_setting(
        &conn,
        "switch_workspace_section",
        &settings.switch_workspace_section,
    )?;
    set_setting(
        &conn,
        "hide_native_menu",
        &settings.hide_native_menu.to_string(),
    )?;
    set_setting(
        &conn,
        "show_gen_info",
        &settings.show_gen_info.to_string(),
    )?;
    set_setting(
        &conn,
        "show_gen_info_token_count",
        &settings.show_gen_info_token_count.to_string(),
    )?;
    set_setting(
        &conn,
        "show_gen_info_duration",
        &settings.show_gen_info_duration.to_string(),
    )?;
    set_setting(
        &conn,
        "show_gen_info_speed",
        &settings.show_gen_info_speed.to_string(),
    )?;
    set_setting(
        &conn,
        "show_gen_info_model",
        &settings.show_gen_info_model.to_string(),
    )?;
    set_setting(
        &conn,
        "memory_enabled",
        &settings.memory_enabled.to_string(),
    )?;
    set_setting(
        &conn,
        "memory_extraction_threshold",
        &settings.memory_extraction_threshold.to_string(),
    )?;
    set_setting(
        &conn,
        "memory_extraction_idle_minutes",
        &settings.memory_extraction_idle_minutes.to_string(),
    )?;
    set_setting(
        &conn,
        "topic_analysis_interval_minutes",
        &settings.topic_analysis_interval_minutes.to_string(),
    )?;
    set_setting(
        &conn,
        "summarization_min_messages",
        &settings.summarization_min_messages.to_string(),
    )?;
    set_setting(
        &conn,
        "summarization_max_sessions",
        &settings.summarization_max_sessions.to_string(),
    )?;
    set_setting(
        &conn,
        "hover_definition_scan_enabled",
        &settings.hover_definition_scan_enabled.to_string(),
    )?;
    set_setting(
        &conn,
        "hover_definition_scan_max_sessions",
        &settings.hover_definition_scan_max_sessions.to_string(),
    )?;
    set_setting(
        &conn,
        "workspace_glossary_refresh_interval_minutes",
        &settings.workspace_glossary_refresh_interval_minutes.to_string(),
    )?;
    set_setting(
        &conn,
        "git_sync_interval_minutes",
        &settings.git_sync_interval_minutes.to_string(),
    )?;
    set_setting(
        &conn,
        "demo_dismissed",
        &settings.demo_dismissed.to_string(),
    )?;
    set_setting(
        &conn,
        "menubar_icon_style",
        &serde_json::to_string(&settings.menubar_icon_style).unwrap(),
    )?;

    if settings.start_at_login {
        if let Err(err) = app.autolaunch().enable() {
            let error = err.to_string();
            if is_windows_missing_autostart_target(&error) {
                crate::logging::log_warn(
                    "settings",
                    format!("Ignoring Windows autostart enable error: {error}"),
                );
            } else {
                return Err(error);
            }
        }
    } else if let Err(err) = app.autolaunch().disable() {
        let error = err.to_string();
        if is_windows_missing_autostart_target(&error) {
            crate::logging::log_warn(
                "settings",
                format!("Ignoring Windows autostart disable error (no entry exists): {error}"),
            );
        } else {
            return Err(error);
        }
    }

    if cfg!(target_os = "macos") && !settings.hide_native_menu {
        if let Ok(menu) = crate::app_menu::build_menu(&app) {
            let _ = app.set_menu(menu);
        }
    } else {
        let _ = app.remove_menu();
    }

    // chat_encryption_enabled is managed by dedicated commands.
    let _ = app.emit("settings-changed", ());
    Ok(())
}

pub fn sync_autostart(app: &AppHandle, conn: &rusqlite::Connection) -> Result<(), String> {
    let enabled = get_setting(conn, "start_at_login")
        .map(|v| v == "true")
        .unwrap_or(false);

    let sync_result = if enabled {
        app.autolaunch().enable().map_err(|e| e.to_string())
    } else {
        app.autolaunch().disable().map_err(|e| e.to_string())
    };

    if let Err(error) = sync_result {
        if is_windows_missing_autostart_target(&error) {
            crate::logging::log_warn(
                "settings",
                format!(
                    "Ignoring Windows autostart sync error during startup; saved preference remains {enabled}: {error}"
                ),
            );
            return Ok(());
        }

        return Err(error);
    }

    Ok(())
}

pub fn should_open_in_background(conn: &rusqlite::Connection) -> bool {
    let launched_from_autostart = std::env::args().any(|arg| arg == AUTOSTART_ARG);
    let open_in_background = get_setting(conn, "open_in_background")
        .map(|v| v == "true")
        .unwrap_or(false);

    launched_from_autostart && open_in_background
}

pub fn should_keep_running_in_tray(app: &AppHandle) -> bool {
    let db_state = app.state::<DbState>();
    match db_state.0.get() {
        Ok(conn) => get_setting(&conn, "keep_running_in_tray")
            .map(|v| v == "true")
            .unwrap_or(false),
        Err(_) => false,
    }
}

#[tauri::command]
pub fn reload_tray_icon(app: AppHandle) -> Result<(), String> {
    // Remove the old tray icon if it exists
    if let Some(tray) = app.tray_by_id("aetherium-tray") {
        let _ = tray.set_visible(false);
    }

    // Rebuild the tray icon with the new style
    crate::build_tray_icon(&app)
}
