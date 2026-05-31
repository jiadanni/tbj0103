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
    pub summarization_model: String,
    pub memory_extraction_model: String,
    pub flashcard_model: String,
    pub glossary_model: String,
    pub topic_signature_model: String,
    pub goal_suggestion_model: String,
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
    pub about_you: String,
    pub inject_about_you_into_chat: bool,
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
    pub user_chat_label: String,
    pub assistant_chat_label: String,
    pub background_inference_enabled: bool,
    pub vram_headroom_gb: f64,
    pub vram_headroom_percent: u32,
    pub ram_headroom_gb: f64,
    pub ram_headroom_percent: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            preferred_model: "".to_string(),
            background_model: "".to_string(),
            summarization_model: "".to_string(),
            memory_extraction_model: "".to_string(),
            flashcard_model: "".to_string(),
            glossary_model: "".to_string(),
            topic_signature_model: "".to_string(),
            goal_suggestion_model: "".to_string(),
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
            about_you: String::new(),
            inject_about_you_into_chat: true,
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
            user_chat_label: "You".to_string(),
            assistant_chat_label: "Assistant".to_string(),
            background_inference_enabled: true,
            vram_headroom_gb: 0.0,
            vram_headroom_percent: 10,
            ram_headroom_gb: 0.0,
            ram_headroom_percent: 10,
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

/// Read every (key, value) pair from the `settings` table in a single query.
/// Used by `get_settings` to avoid issuing ~70 sequential SELECTs during a
/// single command — which compounds with concurrent get_settings calls into
/// multi-second stalls on the SQLite reader.
pub(crate) fn load_all_settings(
    conn: &rusqlite::Connection,
) -> Result<std::collections::HashMap<String, String>, String> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut map = std::collections::HashMap::new();
    for row in rows {
        let (k, v) = row.map_err(|e| e.to_string())?;
        map.insert(k, v);
    }
    Ok(map)
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
pub async fn get_settings(app: AppHandle, state: State<'_, DbState>) -> Result<Settings, String> {
    // Cheap autolaunch query first, on the caller's thread. If we moved this
    // into spawn_blocking we would have to send the autostart manager across
    // threads, which it does not support on all platforms.
    let stored_start_at_login_default = Settings::default().start_at_login;
    let autostart_check = app.autolaunch().is_enabled();

    // Clone the pool handle so the closure owns it and lives on the blocking
    // thread. Pool<SqliteConnectionManager> is Clone+Send+'static.
    let pool = state.0.clone();

    tokio::task::spawn_blocking(move || -> Result<Settings, String> {
        let __t0 = std::time::Instant::now();
        let conn = pool.get().map_err(|e| e.to_string())?;
        let __t_pool = __t0.elapsed();

        let __t1 = std::time::Instant::now();
        let settings_map = load_all_settings(&conn)?;
        let __t_load = __t1.elapsed();
        let __row_count = settings_map.len();

        let def = Settings::default();

        // Below, we shadow the module-level `get_setting` with a closure of
        // the same signature so the ~70 existing call sites don't need to be
        // rewritten — they all now do HashMap lookups instead of issuing one
        // SELECT each.
        #[allow(clippy::redundant_closure)]
        let get_setting = |_conn: &rusqlite::Connection, key: &str| {
            settings_map.get(key).cloned()
        };

        let __t2 = std::time::Instant::now();
        let stored_start_at_login = get_setting(&conn, "start_at_login")
            .map(|v| v == "true")
            .unwrap_or(stored_start_at_login_default);
        let start_at_login = match autostart_check {
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

        let __settings = Settings {
        preferred_model: get_setting(&conn, "preferred_model")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.preferred_model),
        background_model: get_setting(&conn, "background_model")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.background_model),
        summarization_model: get_setting(&conn, "summarization_model")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.summarization_model),
        memory_extraction_model: get_setting(&conn, "memory_extraction_model")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.memory_extraction_model),
        flashcard_model: get_setting(&conn, "flashcard_model")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.flashcard_model),
        glossary_model: get_setting(&conn, "glossary_model")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.glossary_model),
        topic_signature_model: get_setting(&conn, "topic_signature_model")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.topic_signature_model),
        goal_suggestion_model: get_setting(&conn, "goal_suggestion_model")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.goal_suggestion_model),
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
        about_you: get_setting(&conn, "about_you")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.about_you),
        inject_about_you_into_chat: get_setting(&conn, "inject_about_you_into_chat")
            .map(|v| v == "true")
            .unwrap_or(def.inject_about_you_into_chat),
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
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_else(|| def.menubar_icon_style.clone()),
        user_chat_label: get_setting(&conn, "user_chat_label")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.user_chat_label),
        assistant_chat_label: get_setting(&conn, "assistant_chat_label")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(def.assistant_chat_label),
        background_inference_enabled: get_setting(&conn, "background_inference_enabled")
            .map(|v| v == "true")
            .unwrap_or(def.background_inference_enabled),
        vram_headroom_gb: get_setting(&conn, "vram_headroom_gb")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.vram_headroom_gb),
        vram_headroom_percent: get_setting(&conn, "vram_headroom_percent")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.vram_headroom_percent),
        ram_headroom_gb: get_setting(&conn, "ram_headroom_gb")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.ram_headroom_gb),
        ram_headroom_percent: get_setting(&conn, "ram_headroom_percent")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.ram_headroom_percent),
        };
        let __t_body = __t2.elapsed();
        let __total = __t0.elapsed();
        crate::logging::log_buffered(
            "info",
            "settings",
            &format!(
                "[GET_SETTINGS_PROFILE] total={:.3}s pool_acquire={:.3}s bulk_load={:.3}s body={:.3}s rows={}",
                __total.as_secs_f64(),
                __t_pool.as_secs_f64(),
                __t_load.as_secs_f64(),
                __t_body.as_secs_f64(),
                __row_count,
            ),
            "{}",
        );
        Ok(__settings)
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))?
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
        "summarization_model",
        &serde_json::to_string(&settings.summarization_model).unwrap(),
    )?;
    set_setting(
        &conn,
        "memory_extraction_model",
        &serde_json::to_string(&settings.memory_extraction_model).unwrap(),
    )?;
    set_setting(
        &conn,
        "flashcard_model",
        &serde_json::to_string(&settings.flashcard_model).unwrap(),
    )?;
    set_setting(
        &conn,
        "glossary_model",
        &serde_json::to_string(&settings.glossary_model).unwrap(),
    )?;
    set_setting(
        &conn,
        "topic_signature_model",
        &serde_json::to_string(&settings.topic_signature_model).unwrap(),
    )?;
    set_setting(
        &conn,
        "goal_suggestion_model",
        &serde_json::to_string(&settings.goal_suggestion_model).unwrap(),
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
        "about_you",
        &serde_json::to_string(&settings.about_you).unwrap(),
    )?;
    set_setting(
        &conn,
        "inject_about_you_into_chat",
        &settings.inject_about_you_into_chat.to_string(),
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
    set_setting(
        &conn,
        "user_chat_label",
        &serde_json::to_string(&settings.user_chat_label).unwrap(),
    )?;
    set_setting(
        &conn,
        "assistant_chat_label",
        &serde_json::to_string(&settings.assistant_chat_label).unwrap(),
    )?;
    set_setting(
        &conn,
        "background_inference_enabled",
        &settings.background_inference_enabled.to_string(),
    )?;
    let vram_headroom_gb = settings.vram_headroom_gb.max(0.0);
    let ram_headroom_gb = settings.ram_headroom_gb.max(0.0);
    let vram_headroom_percent = settings.vram_headroom_percent.min(90);
    let ram_headroom_percent = settings.ram_headroom_percent.min(90);
    set_setting(&conn, "vram_headroom_gb", &vram_headroom_gb.to_string())?;
    set_setting(
        &conn,
        "vram_headroom_percent",
        &vram_headroom_percent.to_string(),
    )?;
    set_setting(&conn, "ram_headroom_gb", &ram_headroom_gb.to_string())?;
    set_setting(
        &conn,
        "ram_headroom_percent",
        &ram_headroom_percent.to_string(),
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

/// Encode a setting value for storage in the `settings` table, matching the
/// per-key serialization scheme used by `update_settings`. Acts as the
/// allow-list for `update_setting` — only keys listed here can be written
/// through the per-key path.
fn encode_known_setting(key: &str, value: &serde_json::Value) -> Result<String, String> {
    match key {
        // Bool keys (stored as the literal strings "true"/"false")
        "demo_dismissed" => value
            .as_bool()
            .map(|b| b.to_string())
            .ok_or_else(|| format!("Expected bool for setting key '{key}'")),
        // Integer keys (stored as plain decimal)
        "font_size" => value
            .as_i64()
            .map(|n| n.to_string())
            .ok_or_else(|| format!("Expected integer for setting key '{key}'")),
        // String keys (stored as JSON-encoded strings)
        "preferred_model"
        | "background_model"
        | "summarization_model"
        | "memory_extraction_model"
        | "flashcard_model"
        | "glossary_model"
        | "topic_signature_model"
        | "goal_suggestion_model"
        | "draft_model"
        | "compare_model_a"
        | "compare_model_b"
        | "embedding_model"
        | "user_chat_label"
        | "assistant_chat_label" => value
            .as_str()
            .ok_or_else(|| format!("Expected string for setting key '{key}'"))
            .and_then(|s| serde_json::to_string(s).map_err(|e| e.to_string())),
        _ => Err(format!("Unknown setting key: {key}")),
    }
}

/// Per-key write that bypasses the full-Settings read-modify-write round-trip.
/// Frontend sites that previously did `get_settings` + `update_settings` just
/// to flip a single field can call this instead — it avoids serializing the
/// ~70-field Settings blob across the IPC boundary on both legs of the call.
#[tauri::command]
pub fn update_setting(
    auth: State<AuthState>,
    state: State<DbState>,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    require_auth(&auth, &state)?;
    let encoded = encode_known_setting(&key, &value)?;
    let conn = state.0.get().map_err(|e| e.to_string())?;
    set_setting(&conn, &key, &encoded)?;
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

// ---------------------------------------------------------------------------
// Split settings commands
// ---------------------------------------------------------------------------
//
// `get_settings` returns the full 70-field `Settings` struct in a single IPC
// response. Serializing that fat blob on the Tauri dispatcher thread is what
// produced the multi-second wedge measured during boot — the SQLite reader
// returned in ~140ms but the response did not surface to the frontend for
// 24-32s.
//
// The three commands below return narrow slices of the same underlying
// settings table so callers can fetch only the rows they need. Each response
// is small enough to serialize on the dispatcher thread without stalling
// other IPC traffic. `get_settings` and `update_settings` are intentionally
// left in place — a follow-up commit will remove them once all callers have
// migrated.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoreSettings {
    pub theme: String,
    pub accent_color: String,
    pub font_size: i64,
    pub sidebar_width: i64,
    pub menubar_icon_style: String,
    pub hide_native_menu: bool,
    pub switch_workspace_section: String,
    pub user_chat_label: String,
    pub assistant_chat_label: String,
    pub demo_dismissed: bool,
    pub web_session_preserve: bool,
    pub chat_title_auto_refresh: String,
    pub chat_title_refresh_interval: i64,
    pub about_you: String,
    pub inject_about_you_into_chat: bool,
    pub prompt_instructions: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiSettings {
    pub preferred_model: String,
    pub background_model: String,
    pub summarization_model: String,
    pub memory_extraction_model: String,
    pub flashcard_model: String,
    pub glossary_model: String,
    pub topic_signature_model: String,
    pub goal_suggestion_model: String,
    pub embedding_model: String,
    pub draft_model: String,
    pub compare_model_a: String,
    pub compare_model_b: String,
    pub ollama_base_url: String,
    pub auto_start_ollama: bool,
    pub mlx_base_url: String,
    pub llamacpp_model_paths: Vec<String>,
    pub dual_model_enabled: bool,
    pub dual_model_execution_mode: String,
    pub chat_json_storage: bool,
    pub chat_encryption_enabled: bool,
    pub show_gen_info: bool,
    pub show_gen_info_token_count: bool,
    pub show_gen_info_duration: bool,
    pub show_gen_info_speed: bool,
    pub show_gen_info_model: bool,
    pub background_inference_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdvancedSettings {
    pub quick_search_models: Vec<String>,
    pub quick_search_shortcut: String,
    pub quick_search_workspace_scope: String,
    pub quick_search_type_filters: Vec<String>,
    pub backup_enabled: bool,
    pub touch_id_enabled: bool,
    pub pin_lock_enabled: bool,
    pub auto_lock_minutes: i64,
    pub start_at_login: bool,
    pub open_in_background: bool,
    pub keep_running_in_tray: bool,
    pub immediate_delete: bool,
    pub confirm_move_to_trash: bool,
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
    pub vram_headroom_gb: f64,
    pub vram_headroom_percent: u32,
    pub ram_headroom_gb: f64,
    pub ram_headroom_percent: u32,
}

#[tauri::command]
pub async fn get_core_settings(state: State<'_, DbState>) -> Result<CoreSettings, String> {
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || -> Result<CoreSettings, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let map = load_all_settings(&conn)?;
        let def = Settings::default();
        let lookup = |key: &str| map.get(key).cloned();

        let stored_theme = lookup("theme")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_else(|| def.theme.clone());
        let normalized_theme = normalize_theme(&stored_theme).to_string();
        if normalized_theme != stored_theme {
            let serialized_theme =
                serde_json::to_string(&normalized_theme).map_err(|e| e.to_string())?;
            set_setting(&conn, "theme", &serialized_theme)?;
        }

        let switch_workspace_section = lookup("switch_workspace_section").unwrap_or_else(|| {
            lookup("switch_workspace_to_chat")
                .map(|v| if v == "true" { "/chat".to_string() } else { String::new() })
                .unwrap_or(def.switch_workspace_section.clone())
        });

        Ok(CoreSettings {
            theme: normalized_theme,
            accent_color: lookup("accent_color")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.accent_color),
            font_size: lookup("font_size")
                .and_then(|v| v.parse().ok())
                .unwrap_or(def.font_size),
            sidebar_width: lookup("sidebar_width")
                .and_then(|v| v.parse().ok())
                .unwrap_or(def.sidebar_width),
            menubar_icon_style: lookup("menubar_icon_style")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or_else(|| def.menubar_icon_style.clone()),
            hide_native_menu: lookup("hide_native_menu")
                .map(|v| v == "true")
                .unwrap_or(def.hide_native_menu),
            switch_workspace_section,
            user_chat_label: lookup("user_chat_label")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.user_chat_label),
            assistant_chat_label: lookup("assistant_chat_label")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.assistant_chat_label),
            demo_dismissed: lookup("demo_dismissed")
                .map(|v| v == "true")
                .unwrap_or(def.demo_dismissed),
            web_session_preserve: lookup("web_session_preserve")
                .map(|v| v == "true")
                .unwrap_or(def.web_session_preserve),
            chat_title_auto_refresh: lookup("chat_title_auto_refresh")
                .unwrap_or(def.chat_title_auto_refresh),
            chat_title_refresh_interval: lookup("chat_title_refresh_interval")
                .and_then(|v| v.parse().ok())
                .unwrap_or(def.chat_title_refresh_interval),
            about_you: lookup("about_you")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.about_you),
            inject_about_you_into_chat: lookup("inject_about_you_into_chat")
                .map(|v| v == "true")
                .unwrap_or(def.inject_about_you_into_chat),
            prompt_instructions: lookup("prompt_instructions")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.prompt_instructions),
        })
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))?
}

#[tauri::command]
pub async fn get_ai_settings(state: State<'_, DbState>) -> Result<AiSettings, String> {
    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || -> Result<AiSettings, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let map = load_all_settings(&conn)?;
        let def = Settings::default();
        let lookup = |key: &str| map.get(key).cloned();

        Ok(AiSettings {
            preferred_model: lookup("preferred_model")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.preferred_model),
            background_model: lookup("background_model")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.background_model),
            summarization_model: lookup("summarization_model")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.summarization_model),
            memory_extraction_model: lookup("memory_extraction_model")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.memory_extraction_model),
            flashcard_model: lookup("flashcard_model")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.flashcard_model),
            glossary_model: lookup("glossary_model")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.glossary_model),
            topic_signature_model: lookup("topic_signature_model")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.topic_signature_model),
            goal_suggestion_model: lookup("goal_suggestion_model")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.goal_suggestion_model),
            embedding_model: lookup("embedding_model")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.embedding_model),
            draft_model: lookup("draft_model")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.draft_model),
            compare_model_a: lookup("compare_model_a")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.compare_model_a),
            compare_model_b: lookup("compare_model_b")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.compare_model_b),
            ollama_base_url: lookup("ollama_base_url")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.ollama_base_url),
            auto_start_ollama: lookup("auto_start_ollama")
                .map(|v| v == "true")
                .unwrap_or(def.auto_start_ollama),
            mlx_base_url: lookup("mlx_base_url")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.mlx_base_url),
            llamacpp_model_paths: lookup("llamacpp_model_paths")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.llamacpp_model_paths),
            dual_model_enabled: lookup("dual_model_enabled")
                .map(|v| v == "true")
                .unwrap_or(def.dual_model_enabled),
            dual_model_execution_mode: lookup("dual_model_execution_mode")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.dual_model_execution_mode),
            chat_json_storage: lookup("chat_json_storage")
                .and_then(|v| v.parse().ok())
                .unwrap_or(def.chat_json_storage),
            chat_encryption_enabled: lookup("chat_encryption_enabled")
                .map(|v| v == "true")
                .unwrap_or(def.chat_encryption_enabled),
            show_gen_info: lookup("show_gen_info")
                .map(|v| v == "true")
                .unwrap_or(def.show_gen_info),
            show_gen_info_token_count: lookup("show_gen_info_token_count")
                .map(|v| v == "true")
                .unwrap_or(def.show_gen_info_token_count),
            show_gen_info_duration: lookup("show_gen_info_duration")
                .map(|v| v == "true")
                .unwrap_or(def.show_gen_info_duration),
            show_gen_info_speed: lookup("show_gen_info_speed")
                .map(|v| v == "true")
                .unwrap_or(def.show_gen_info_speed),
            show_gen_info_model: lookup("show_gen_info_model")
                .map(|v| v == "true")
                .unwrap_or(def.show_gen_info_model),
            background_inference_enabled: lookup("background_inference_enabled")
                .map(|v| v == "true")
                .unwrap_or(def.background_inference_enabled),
        })
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))?
}

#[tauri::command]
pub async fn get_advanced_settings(
    app: AppHandle,
    state: State<'_, DbState>,
) -> Result<AdvancedSettings, String> {
    // Same pattern as `get_settings`: query autolaunch on the caller's thread
    // because the autostart manager is not Send on every platform.
    let stored_start_at_login_default = Settings::default().start_at_login;
    let autostart_check = app.autolaunch().is_enabled();

    let pool = state.0.clone();
    tokio::task::spawn_blocking(move || -> Result<AdvancedSettings, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let map = load_all_settings(&conn)?;
        let def = Settings::default();
        let lookup = |key: &str| map.get(key).cloned();

        let stored_start_at_login = lookup("start_at_login")
            .map(|v| v == "true")
            .unwrap_or(stored_start_at_login_default);
        let start_at_login = match autostart_check {
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

        let pin_configured = lookup("pin_passcode_hash")
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false);
        let pin_lock_enabled = lookup("pin_lock_enabled")
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.pin_lock_enabled)
            && pin_configured;
        let biometric_available = biometric_available();

        Ok(AdvancedSettings {
            quick_search_models: lookup("quick_search_models")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.quick_search_models),
            quick_search_shortcut: lookup("quick_search_shortcut")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.quick_search_shortcut),
            quick_search_workspace_scope: lookup("quick_search_workspace_scope")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.quick_search_workspace_scope),
            quick_search_type_filters: lookup("quick_search_type_filters")
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or(def.quick_search_type_filters),
            backup_enabled: lookup("backup_enabled")
                .and_then(|v| v.parse().ok())
                .unwrap_or(def.backup_enabled),
            touch_id_enabled: lookup("touch_id_enabled")
                .and_then(|v| v.parse().ok())
                .unwrap_or(def.touch_id_enabled)
                && biometric_available
                && pin_lock_enabled,
            pin_lock_enabled,
            auto_lock_minutes: lookup("auto_lock_minutes")
                .and_then(|v| v.parse().ok())
                .unwrap_or(def.auto_lock_minutes),
            start_at_login,
            open_in_background: lookup("open_in_background")
                .map(|v| v == "true")
                .unwrap_or(def.open_in_background),
            keep_running_in_tray: lookup("keep_running_in_tray")
                .map(|v| v == "true")
                .unwrap_or(def.keep_running_in_tray),
            immediate_delete: lookup("immediate_delete")
                .map(|v| v == "true")
                .unwrap_or(def.immediate_delete),
            confirm_move_to_trash: lookup("confirm_move_to_trash")
                .map(|v| v == "true")
                .unwrap_or(def.confirm_move_to_trash),
            memory_enabled: lookup("memory_enabled")
                .map(|v| v == "true")
                .unwrap_or(def.memory_enabled),
            memory_extraction_threshold: lookup("memory_extraction_threshold")
                .and_then(|v| v.parse().ok())
                .unwrap_or(def.memory_extraction_threshold),
            memory_extraction_idle_minutes: lookup("memory_extraction_idle_minutes")
                .and_then(|v| v.parse().ok())
                .unwrap_or(def.memory_extraction_idle_minutes),
            topic_analysis_interval_minutes: lookup("topic_analysis_interval_minutes")
                .and_then(|v| v.parse().ok())
                .unwrap_or(def.topic_analysis_interval_minutes),
            summarization_min_messages: lookup("summarization_min_messages")
                .and_then(|v| v.parse().ok())
                .unwrap_or(def.summarization_min_messages),
            summarization_max_sessions: lookup("summarization_max_sessions")
                .and_then(|v| v.parse().ok())
                .unwrap_or(def.summarization_max_sessions),
            hover_definition_scan_enabled: lookup("hover_definition_scan_enabled")
                .map(|v| v == "true")
                .unwrap_or(def.hover_definition_scan_enabled),
            hover_definition_scan_max_sessions: lookup("hover_definition_scan_max_sessions")
                .and_then(|v| v.parse().ok())
                .unwrap_or(def.hover_definition_scan_max_sessions),
            workspace_glossary_refresh_interval_minutes: lookup(
                "workspace_glossary_refresh_interval_minutes",
            )
            .and_then(|v| v.parse().ok())
            .unwrap_or(def.workspace_glossary_refresh_interval_minutes),
            git_sync_interval_minutes: lookup("git_sync_interval_minutes")
                .and_then(|v| v.parse().ok())
                .unwrap_or(def.git_sync_interval_minutes),
            vram_headroom_gb: lookup("vram_headroom_gb")
                .and_then(|v| v.parse().ok())
                .unwrap_or(def.vram_headroom_gb),
            vram_headroom_percent: lookup("vram_headroom_percent")
                .and_then(|v| v.parse().ok())
                .unwrap_or(def.vram_headroom_percent),
            ram_headroom_gb: lookup("ram_headroom_gb")
                .and_then(|v| v.parse().ok())
                .unwrap_or(def.ram_headroom_gb),
            ram_headroom_percent: lookup("ram_headroom_percent")
                .and_then(|v| v.parse().ok())
                .unwrap_or(def.ram_headroom_percent),
        })
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_utils::tests::setup_test_db;

    // Settings whose writer JSON-encodes the value (`serde_json::to_string`).
    // Each entry's reader must also JSON-decode on the way out, or the value
    // will double in size on every save round-trip — see the menubar_icon_style
    // incident (commit e99e554). This list mirrors the encoded writes in
    // update_settings. If you add a new JSON-encoded string setting, add it
    // here too so the round-trip test covers it.
    const JSON_ENCODED_STRING_KEYS: &[(&str, &str)] = &[
        ("preferred_model", "llama3"),
        ("background_model", "llama3"),
        ("summarization_model", "llama3"),
        ("memory_extraction_model", "llama3"),
        ("flashcard_model", "llama3"),
        ("glossary_model", "llama3"),
        ("topic_signature_model", "llama3"),
        ("goal_suggestion_model", "llama3"),
        ("draft_model", "llama3"),
        ("compare_model_a", "llama3"),
        ("compare_model_b", "llama3"),
        ("embedding_model", "nomic-embed-text"),
        ("quick_search_shortcut", "CmdOrCtrl+Shift+K"),
        ("quick_search_workspace_scope", "current"),
        ("theme", "noir"),
        ("accent_color", "#007AFF"),
        ("ollama_base_url", "http://localhost:11434"),
        ("mlx_base_url", "http://localhost:8000"),
        ("dual_model_execution_mode", "serial"),
        ("prompt_instructions", "Be concise."),
        ("about_you", "Software engineer in Berlin."),
        ("menubar_icon_style", "monochrome"),
        ("user_chat_label", "You"),
        ("assistant_chat_label", "Assistant"),
    ];

    /// Round-trip a JSON-encoded string setting through the same write path
    /// used by update_settings and the same decode shape used by the readers.
    /// If a future setting is added with the writer encoding but the reader
    /// reading raw, the stored byte length will double each cycle and the
    /// assertion at the end will fail.
    #[test]
    fn json_encoded_string_settings_are_size_stable_across_round_trips() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();

        for (key, sample) in JSON_ENCODED_STRING_KEYS {
            // Cycle 1: encode + write, then read + decode.
            let encoded_1 = serde_json::to_string(sample).unwrap();
            set_setting(&conn, key, &encoded_1).unwrap();
            let len_after_1 = get_setting(&conn, key).map(|v| v.len()).unwrap_or(0);

            let decoded_1: String = get_setting(&conn, key)
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or_else(|| panic!(
                    "key `{key}` did not round-trip through JSON decode \
                    — its reader is probably missing `serde_json::from_str` \
                    (this is the menubar_icon_style bug shape)"
                ));
            assert_eq!(
                &decoded_1, sample,
                "key `{key}` decoded to a different value than was written"
            );

            // Cycle 2 + 3: encode the decoded value and write again. If the
            // reader were reading raw, `decoded_1` would still contain JSON
            // quote characters and re-encoding would wrap them again — the
            // stored length would double on each cycle.
            let encoded_2 = serde_json::to_string(&decoded_1).unwrap();
            set_setting(&conn, key, &encoded_2).unwrap();
            let decoded_2: String = get_setting(&conn, key)
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap();

            let encoded_3 = serde_json::to_string(&decoded_2).unwrap();
            set_setting(&conn, key, &encoded_3).unwrap();
            let len_after_3 = get_setting(&conn, key).map(|v| v.len()).unwrap_or(0);

            assert_eq!(
                len_after_1, len_after_3,
                "key `{key}` stored byte length grew across three save \
                round-trips (was {len_after_1}, now {len_after_3}). The \
                writer JSON-encodes but the reader likely reads the raw \
                value without decoding — match the reader to the writer."
            );
        }
    }

    /// Direct regression test for the exact bug observed in production:
    /// the reader pulled the raw JSON-encoded value and the writer wrapped
    /// it again, growing menubar_icon_style to 268MB over ~28 saves. This
    /// simulates a buggy reader to prove the assertion catches it.
    #[test]
    fn buggy_raw_reader_causes_unbounded_growth() {
        let pool = setup_test_db();
        let conn = pool.get().unwrap();

        let key = "menubar_icon_style";
        set_setting(&conn, key, &serde_json::to_string("monochrome").unwrap()).unwrap();
        let len_after_1 = get_setting(&conn, key).map(|v| v.len()).unwrap_or(0);

        // Buggy read: no JSON decode. Now the writer's re-encode wraps the
        // already-encoded value, and the stored length grows each cycle.
        for _ in 0..3 {
            let raw_value: String = get_setting(&conn, key).unwrap();
            let re_encoded = serde_json::to_string(&raw_value).unwrap();
            set_setting(&conn, key, &re_encoded).unwrap();
        }
        let len_after_4 = get_setting(&conn, key).map(|v| v.len()).unwrap_or(0);

        assert!(
            len_after_4 > len_after_1,
            "expected the buggy raw-reader pattern to grow the stored value; \
            saw {len_after_1} → {len_after_4}. If this assertion no longer \
            fires, the writer may have stopped JSON-encoding — re-verify the \
            round-trip shape in update_settings."
        );
    }
}
