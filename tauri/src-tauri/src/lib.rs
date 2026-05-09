pub mod app_menu;
pub mod commands;
pub mod db;
pub mod llamacpp;
pub mod logging;
pub mod mcp_client;
pub mod mcp_server;
pub mod mlx;
pub mod models;
pub mod ollama;
pub mod services;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
#[cfg(not(target_os = "linux"))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::{AppHandle, Manager};
#[cfg(target_os = "linux")]
use tauri::PhysicalPosition;
#[cfg(target_os = "linux")]
use tauri::PhysicalSize;
use tauri::{WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::ShortcutState;

#[cfg(target_os = "linux")]
const MAIN_WINDOW_STATE_KEY: &str = "linux_main_window_state";
#[cfg(target_os = "linux")]
const LINUX_TOP_PANEL_SAFE_INSET: i32 = 48;

#[cfg(target_os = "linux")]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct SavedWindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

#[cfg(target_os = "linux")]
fn load_saved_main_window_state(conn: &rusqlite::Connection) -> Option<SavedWindowState> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![MAIN_WINDOW_STATE_KEY],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|value| serde_json::from_str(&value).ok())
}

#[cfg(target_os = "linux")]
fn save_main_window_state(
    conn: &rusqlite::Connection,
    window: &tauri::WebviewWindow,
) -> Result<(), String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let maximized = window.is_maximized().map_err(|e| e.to_string())?;

    // When maximized, outer_position() often returns (0, 0) on Linux WMs.
    // Save the monitor's safe origin instead so that if the user un-maximizes
    // on next launch the window appears below the panel, not under it.
    let (save_x, save_y) = if maximized {
        if let Ok(Some(monitor)) = window.current_monitor() {
            let mp = monitor.position();
            (mp.x, mp.y + LINUX_TOP_PANEL_SAFE_INSET)
        } else {
            (position.x, position.y.max(LINUX_TOP_PANEL_SAFE_INSET))
        }
    } else {
        (position.x, position.y)
    };

    let state = SavedWindowState {
        x: save_x,
        y: save_y,
        width: size.width,
        height: size.height,
        maximized,
    };
    let serialized = serde_json::to_string(&state).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![MAIN_WINDOW_STATE_KEY, serialized],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn apply_saved_main_window_state(
    state: &SavedWindowState,
    window: &tauri::WebviewWindow,
) -> Result<(), String> {
    let mut next_state = state.clone();

    // Find the monitor that contains the saved top-left corner so that the window
    // is restored to the same monitor it was on when last closed, not just the
    // primary monitor (which is what current_monitor() would return at startup
    // before the position is applied).
    let target_monitor = window
        .available_monitors()
        .ok()
        .and_then(|monitors| {
            monitors.into_iter().find(|m| {
                let mp = m.position();
                let ms = m.size();
                next_state.x >= mp.x
                    && next_state.x < mp.x + ms.width as i32
                    && next_state.y >= mp.y
                    && next_state.y < mp.y + ms.height as i32
            })
        })
        .or_else(|| window.current_monitor().ok().flatten());

    if let Some(monitor) = target_monitor {
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let safe_top = monitor_position.y + LINUX_TOP_PANEL_SAFE_INSET;
        let safe_height = monitor_size
            .height
            .saturating_sub(LINUX_TOP_PANEL_SAFE_INSET as u32)
            .max(1);

        if next_state.maximized {
            next_state.x = monitor_position.x;
            next_state.y = safe_top;
            next_state.width = monitor_size.width;
            next_state.height = safe_height;
        } else {
            next_state.width = next_state.width.min(monitor_size.width);
            next_state.height = next_state.height.min(safe_height);

            let max_x = monitor_position.x + monitor_size.width as i32 - next_state.width as i32;
            let max_y = monitor_position.y + monitor_size.height as i32 - next_state.height as i32;

            next_state.x = next_state.x.clamp(monitor_position.x, max_x.max(monitor_position.x));
            next_state.y = next_state.y.clamp(safe_top, max_y.max(safe_top));
        }
    } else {
        next_state.y = next_state.y.max(LINUX_TOP_PANEL_SAFE_INSET);
    }

    window
        .set_size(PhysicalSize::new(next_state.width, next_state.height))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(next_state.x, next_state.y))
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Register a panic hook that flushes buffered logs before the process exits,
    // ensuring the crash cause is captured in the SQLite log table.
    std::panic::set_hook(Box::new(|info| {
        let msg = info
            .payload()
            .downcast_ref::<&'static str>()
            .copied()
            .or_else(|| {
                info.payload()
                    .downcast_ref::<String>()
                    .map(|s| s.as_str())
            })
            .unwrap_or("Box<dyn Any>");
        let location = info
            .location()
            .map(|loc| format!("{}:{}", loc.file(), loc.line()))
            .unwrap_or_else(|| "unknown".to_string());
        crate::logging::log_error("panic", format!("Panic at {location}: {msg}"));
        crate::logging::flush_buffered();
    }));

    let run_result = tauri::Builder::default()
        .on_menu_event(app_menu::handle_menu_event)
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = commands::quick_search::toggle_window(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_autostart::init(
                MacosLauncher::LaunchAgent,
                Some(vec!["--autostart"]),
            ))?;

            // Initialize SQLite database
            let app_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Failed to get app data directory: {e}"))?;
            std::fs::create_dir_all(&app_dir)?;
            let db_path = app_dir.join("aetherium.db");
            let pool = db::initialize_database(&db_path)
                .map_err(|e| format!("Failed to initialize database: {e}"))?;

            let conn = pool.get().map_err(|e| format!("Failed to get DB connection: {e}"))?;

            commands::settings::sync_autostart(&app.handle().clone(), &conn)
                .map_err(|e| format!("Failed to synchronize autostart setting: {e}"))?;
            let should_open_in_background = commands::settings::should_open_in_background(&conn);
            #[cfg(target_os = "linux")]
            let saved_main_window_state = load_saved_main_window_state(&conn);
            let quick_search_shortcut: String = conn
                .query_row(
                    "SELECT value FROM settings WHERE key = 'quick_search_shortcut'",
                    [],
                    |row| row.get(0),
                )
                .ok()
                .and_then(|value: String| serde_json::from_str(&value).ok())
                .unwrap_or_else(|| "CmdOrCtrl+Shift+K".to_string());

            // Resolve the chats directory and try to load encryption passphrase
            let chats_dir = app_dir.join("chats");
            let passphrase = commands::chat_file::load_crypto_state_from_keyring(&conn);
            crate::services::quick_search_index::ensure_populated(&conn)
                .map_err(|e| format!("Failed to populate quick search index: {e}"))?;

            drop(conn);

            // Initialize persistent logging with the DB pool
            crate::logging::init_pool(pool.clone());
            // Apply persisted log level before starting the flush timer.
            {
                let log_conn = pool.get().map_err(|e| format!("Failed to get DB connection: {e}"))?;
                if let Ok(row) = log_conn.query_row(
                    "SELECT value FROM settings WHERE key = 'log_level'",
                    [],
                    |r| r.get::<_, String>(0),
                ) {
                    if let Ok(level) = serde_json::from_str::<String>(&row) {
                        crate::logging::set_min_log_level(&level);
                    }
                }
            }
            crate::logging::start_flush_timer();

            app.manage(db::DbState(pool));
            app.manage(commands::chat_file::ChatsDirState(chats_dir));
            app.manage(commands::chat_file::ChatCryptoState(
                std::sync::Mutex::new(passphrase),
            ));
            app.manage(commands::ollama::StreamAbortState(
                std::sync::Mutex::new(std::collections::HashMap::new()),
            ));
            let (bg_cancel_tx, _) = tokio::sync::watch::channel(0u64);
            app.manage(commands::ollama::BackgroundInferenceCancel(bg_cancel_tx));
            app.manage(commands::quick_search::QuickSearchRuntimeState::default());
            app.manage(commands::security::AuthState::default());

            #[cfg(feature = "llamacpp")]
            {
                // Initialize llama.cpp worker
                let worker_state = llamacpp::worker::spawn_inference_worker(app.handle().clone());
                app.manage(worker_state);
                app.manage(commands::llamacpp::LlamacppCancelState(
                    std::sync::Mutex::new(std::collections::HashMap::new()),
                ));
            }

            // Initialize MCP Client Manager
            let mcp_manager = std::sync::Arc::new(tokio::sync::Mutex::new(
                mcp_client::MCPClientManager::new()
            ));
            app.manage(mcp_manager);

            ensure_quick_search_window(app)
                .map_err(|e| format!("Failed to create quick search window: {e}"))?;
            let tray_handle = app.handle().clone();
            build_tray_icon(&tray_handle)
                .map_err(|e| format!("Failed to create tray icon: {e}"))?;

            {
                let runtime_state = app.state::<commands::quick_search::QuickSearchRuntimeState>();
                commands::quick_search::apply_shortcut(
                    app.handle(),
                    &runtime_state,
                    commands::quick_search::normalize_shortcut(&quick_search_shortcut),
                )
                .map_err(|e| format!("Failed to register quick search shortcut: {e}"))?;
            }

            if let Some(window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                let main_window = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        if commands::settings::should_keep_running_in_tray(&app_handle) {
                            api.prevent_close();
                            let _ = main_window.hide();
                        }
                    }
                });

                if should_open_in_background {
                    let _ = window.hide();
                } else {
                    let _ = window.set_focus();
                    #[cfg(target_os = "linux")]
                    {
                        if let Some(state) = saved_main_window_state.as_ref() {
                            let _ = apply_saved_main_window_state(state, &window);
                        } else {
                            let _ = window.center();
                            let _ = window.maximize();
                        }
                    }
                    #[cfg(not(target_os = "linux"))]
                    {
                        let _ = window.maximize();
                    }
                }

                #[cfg(target_os = "linux")]
                {
                    let app_handle = app.handle().clone();
                    let main_window = window.clone();
                    window.on_window_event(move |event| {
                        let should_persist = matches!(
                            event,
                            WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::CloseRequested { .. }
                        );
                        if !should_persist {
                            return;
                        }

                        let db_state = app_handle.state::<db::DbState>();
                        if let Ok(conn) = db_state.0.get() {
                            let _ = save_main_window_state(&conn, &main_window);
                        }
                    });
                }
            }

            let hide_native_menu = {
                let db_state = app.state::<db::DbState>();
                if let Ok(conn) = db_state.0.get() {
                    let val: String = conn.query_row(
                        "SELECT value FROM settings WHERE key = 'hide_native_menu'",
                        [],
                        |row| row.get(0)
                    ).unwrap_or_else(|_| "false".to_string());
                    val == "true"
                } else {
                    false
                }
            };

            let should_use_native_menu = cfg!(target_os = "macos") && !hide_native_menu;

            if should_use_native_menu {
                let menu = app_menu::build_menu(app.handle())
                    .map_err(|e| format!("Failed to build menu: {e}"))?;
                app.set_menu(menu)
                    .map_err(|e| format!("Failed to set menu: {e}"))?;
            } else {
                let _ = app.remove_menu();
            }

            // Start background scheduler
            crate::services::background_scheduler::start_scheduler(app.handle().clone());

            // Spawn background timer for topic signatures
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Initial delay
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                loop {
                    let interval_minutes = {
                        let state = app_handle.state::<db::DbState>();
                        match state.0.get() {
                            Ok(conn) => {
                                let val: String = conn.query_row(
                                    "SELECT value FROM settings WHERE key = 'topic_analysis_interval_minutes'",
                                    [],
                                    |row| row.get(0)
                                ).unwrap_or_else(|_| "30".to_string());
                                val.parse::<u64>().unwrap_or(30)
                            }
                            Err(_) => 30,
                        }
                    };

                    {
                        let db = app_handle.state::<db::DbState>();
                        let cancel_rx = app_handle
                            .state::<commands::ollama::BackgroundInferenceCancel>()
                            .0
                            .subscribe();
                        let workspace_ids: Vec<String> = {
                            let Ok(conn) = db.0.get() else {
                                tokio::time::sleep(std::time::Duration::from_secs(interval_minutes * 60)).await;
                                continue;
                            };
                            conn.prepare("SELECT id FROM workspaces")
                                .and_then(|mut stmt| {
                                    stmt.query_map([], |row| row.get::<_, String>(0))?
                                        .collect::<Result<Vec<_>, _>>()
                                })
                                .unwrap_or_default()
                        };

                        for id in workspace_ids {
                            let _ = crate::services::topic_signature::recompute_workspace_signature_with_ai(
                                &db, &id, None, None, Some(cancel_rx.clone()),
                            ).await;
                        }
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(interval_minutes * 60)).await;
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Workspace commands
            commands::workspace::create_workspace,
            commands::workspace::create_child_workspace,
            commands::workspace::list_workspaces,
            commands::workspace::list_root_workspaces,
            commands::workspace::list_child_workspaces,
            commands::workspace::list_hidden_workspaces,
            commands::workspace::get_workspace,
            commands::workspace::update_workspace,
            commands::workspace::delete_workspace,
            commands::workspace::set_workspace_parent,
            commands::workspace::update_workspace_icon,
            commands::workspace::recommend_workspace_icon,
            commands::workspace::hide_workspace,
            commands::workspace::unhide_workspace,
            commands::workspace::reorder_workspaces,
            // Project commands
            commands::project::create_project,
            commands::project::list_projects,
            commands::project::get_project,
            commands::project::update_project,
            commands::project::delete_project,
            commands::project::move_project_to_workspace,
            commands::dashboard::get_dashboard_summary,
            // Artifact commands
            commands::artifact::create_artifact,
            commands::artifact::get_artifact,
            commands::artifact::list_artifacts,
            commands::artifact::get_artifact_versions,
            commands::artifact::update_artifact,
            commands::artifact::delete_artifact,
            commands::artifact::search_artifacts,
            commands::artifact::create_artifact_version,
            // Summary commands
            commands::summary::generate_summary,
            commands::summary::list_summaries,
            // Context & Chat
            commands::context::assemble_and_send,
            commands::chat::create_chat_session,
            commands::chat::list_chat_sessions,
            commands::chat::search_chat_sessions,
            commands::chat::get_chat_session,
            commands::chat::get_related_chats,
            commands::chat::delete_chat_session,
            commands::chat::add_message,
            commands::chat::get_messages,
            commands::chat::refresh_message,
            commands::chat::get_message_variants,
            commands::chat::list_deleted_chat_sessions,
            commands::chat::restore_chat_session,
            commands::chat::hard_delete_chat_session,
            commands::chat::empty_recycle_bin,
            commands::chat::move_chat_sessions,
            commands::chat::batch_move_sessions,
            // Knowledge graph commands
            commands::knowledge_graph::create_concept,
            commands::knowledge_graph::list_concepts,
            commands::knowledge_graph::get_concept,
            commands::knowledge_graph::update_concept,
            commands::knowledge_graph::delete_concept,
            commands::knowledge_graph::create_concept_link,
            commands::knowledge_graph::list_concept_links,
            commands::knowledge_graph::delete_concept_link,
            commands::knowledge_graph::get_graph_stats,
            commands::knowledge_graph::get_learning_path,
            commands::knowledge_graph::extract_and_link_concepts,
            // Learning goal commands
            commands::learning_goal::create_learning_goal,
            commands::learning_goal::list_learning_goals,
            commands::learning_goal::update_learning_goal,
            commands::learning_goal::delete_learning_goal,
            // Flashcard commands
            commands::flashcard::create_flashcard,
            commands::flashcard::list_flashcards_due,
            commands::flashcard::review_flashcard,
            commands::flashcard::get_review_stats,
            commands::flashcard::generate_flashcards,
            commands::flashcard::generate_flashcards_from_concept,
            commands::flashcard::list_flashcards_by_concept,
            commands::flashcard::list_graph_flashcards,
            commands::flashcard::extract_flashcards_from_content,
            // Note & template commands
            commands::note::create_note,
            commands::note::list_notes,
            commands::note::get_note,
            commands::note::update_note,
            commands::note::delete_note,
            commands::note::get_or_create_daily_note,
            commands::note::list_templates,
            commands::note::create_template,
            commands::note::apply_template,
            commands::note::get_backlinks,
            commands::note::get_note_outbound_links,
            // Chat → Note / Document conversion
            commands::chat_conversion::convert_chat_to_note,
            commands::chat_conversion::convert_chat_to_document,
            // Document commands
            commands::document::upload_document,
            commands::document::list_documents,
            commands::document::get_document,
            commands::document::delete_document,
            commands::document::process_document,
            // Search commands
            commands::search::semantic_search,
            commands::search::keyword_search,
            // Ollama commands
            commands::ollama::send_message,
            commands::ollama::list_models,
            commands::ollama::list_models_fresh,
            commands::ollama::ensure_ollama_running,
            commands::ollama::generate_title,
            commands::ollama::generate_title_from_conversation,
            commands::ollama::polish_prompt,
            commands::ollama::generate_embedding,
            commands::ollama::send_dual_model_message,
            commands::ollama::extract_topics,
            commands::ollama::generate_follow_ups,
            commands::ollama::stop_stream,
            commands::ollama::unload_model,
            commands::ollama::list_loaded_models,
            // MLX commands
            commands::mlx::send_mlx_message,
            commands::mlx::list_mlx_models,
            // llama.cpp commands
            commands::llamacpp::send_llamacpp_message,
            commands::llamacpp::stop_llamacpp_stream,
            commands::llamacpp::list_llamacpp_models,
            // Export commands
            commands::export::export_markdown,
            commands::export::export_json,
            commands::export::export_obsidian_vault,
            // Backup commands
            commands::backup::create_backup,
            commands::backup::list_backups,
            commands::backup::restore_backup,
            commands::backup::delete_backup,
            commands::backup::create_global_backup,
            commands::backup::restore_global_backup,
            // Settings commands
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::settings::reload_tray_icon,
            commands::system::get_system_specs,
            commands::system::get_performance_stats,
            commands::system::toggle_devtools,
            commands::system::open_preferences_window,
            commands::security::get_security_status,
            commands::security::set_pin_passcode,
            commands::security::verify_pin_passcode,
            commands::security::remove_pin_passcode,
            commands::security::authenticate_biometric,
            commands::security::unlock_app,
            commands::security::lock_app,
            // Graph algorithm commands
            commands::graph::compute_pagerank,
            commands::graph::find_shortest_path,
            commands::graph::detect_communities,
            // Demo commands
            commands::demo::activate_demo_mode,
            commands::demo::deactivate_demo_mode,
            // Alarm commands
            commands::alarm::create_alarm,
            commands::alarm::list_alarms,
            commands::alarm::delete_alarm,
            // Note extra commands
            commands::note::list_daily_notes_in_range,
            commands::note::update_daily_note,
            commands::note::delete_template,
            commands::note::update_template,
            // Chat session update
            commands::chat::update_chat_session,
            commands::chat::get_token_usage_by_date,
            commands::chat::touch_session_accessed,
            commands::chat::get_recent_sessions,
            // Project stats
            commands::project::get_project_stats,
            // Web capture commands
            commands::web_capture::create_web_capture,
            commands::web_capture::list_web_captures,
            commands::web_capture::get_web_capture,
            commands::web_capture::delete_web_capture,
            commands::web_capture::update_web_capture,
            // Unified source commands
            commands::source::create_source,
            commands::source::list_sources,
            commands::source::get_source,
            commands::source::update_source,
            commands::source::delete_source,
            commands::source::process_source,
            // AI model commands
            commands::ai_model::list_ai_models,
            commands::ai_model::add_ai_model,
            commands::ai_model::update_ai_model,
            commands::ai_model::delete_ai_model,
            commands::ai_model::get_default_model,
            commands::ai_model::record_model_token_usage,
            commands::ai_model::list_model_speed_stats,
            // AI knowledge commands
            commands::ai_knowledge::analyze_workspace,
            commands::ai_knowledge::analyze_descendants,
            commands::ai_knowledge::suggest_learning_goals,
            // Memory commands
            commands::memory::create_memory,
            commands::memory::list_memories,
            commands::memory::list_global_memories,
            commands::memory::update_memory,
            commands::memory::delete_memory,
            commands::memory::get_active_memories,
            commands::memory::extract_memories,
            commands::memory::delete_all_memories,
            commands::memory::deactivate_all_memories,
            // MCP commands
            commands::mcp::list_mcp_servers,
            commands::mcp::add_mcp_server,
            commands::mcp::update_mcp_server,
            commands::mcp::delete_mcp_server,
            commands::mcp::mcp_list_tools,
            commands::mcp::mcp_list_resources,
            commands::mcp::mcp_call_tool,
            commands::mcp::mcp_read_resource,
            commands::mcp::mcp_connect_server,
            commands::mcp::mcp_disconnect_server,
            // Thought queue commands
            commands::thought_queue::create_thought,
            commands::thought_queue::list_thoughts,
            commands::thought_queue::list_thoughts_by_session,
            commands::thought_queue::get_due_thoughts,
            commands::thought_queue::update_thought_status,
            commands::thought_queue::update_thought_result,
            commands::thought_queue::delete_thought,
            // Chat file / encryption commands
            commands::chat_file::get_chat_file_info,
            commands::chat_file::reveal_chat_file,
            commands::chat_file::setup_chat_encryption,
            commands::chat_file::disable_chat_encryption,
            commands::chat_file::export_chat_as_json,
            commands::chat_file::import_chat_from_json,
            commands::chat_file::sync_all_chats_to_files,
            commands::chat_file::preview_lmstudio_folder,
            commands::chat_file::import_lmstudio_folder,
            commands::chat_file::import_multiple_folders,
            commands::chat_file::import_gemini_takeout,
            commands::chat_file::import_claude_files,
            commands::chat_file::preview_claude_files,
            // Web AI (Playwright bridge)
            commands::web_ai::send_web_message,
            // Topic signatures
            commands::topic_signature::get_topic_signature,
            commands::topic_signature::regenerate_topic_signature,
            commands::topic_signature::update_topic_signature,
            commands::topic_signature::check_workspace_match,
            // Git sync commands
            commands::git_sync::get_git_sync_status,
            commands::git_sync::configure_git_sync,
            commands::git_sync::trigger_git_sync,
            // Quick search
            commands::quick_search::show_quick_search,
            commands::quick_search::hide_quick_search,
            commands::quick_search::query_quick_search,
            commands::quick_search::get_quick_search_context,
            commands::quick_search::open_quick_search_result,
            commands::quick_search::mark_main_window_ready,
            // Log commands
            commands::log::get_logs,
            commands::log::get_log_sources,
            commands::log::clear_logs,
            commands::log::log_frontend_event,
            commands::log::log_frontend_events_batch,
            commands::log::set_log_level,
            commands::log::get_log_level,
        ])
        .run(tauri::generate_context!());

    if let Err(err) = run_result {
        crate::logging::log_error("app", format!("error while running tauri application: {err}"));
    }
}

fn ensure_quick_search_window(app: &tauri::App) -> Result<(), String> {
    if app.get_webview_window("quick-search").is_some() {
        return Ok(());
    }

    WebviewWindowBuilder::new(
        app,
        "quick-search",
        WebviewUrl::App("quick-search.html".into()),
    )
    .title("Quick Search")
    .inner_size(540.0, 420.0)
    .min_inner_size(420.0, 260.0)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .transparent(true)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible(false)
    .focused(false)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn build_tray_icon(app: &AppHandle) -> Result<(), String> {
    // Try to load the menubar icon based on settings
    let tray_icon = load_tray_icon(app);
    let icon = tray_icon.or_else(|_| {
        // Fallback to default window icon if menubar icon not found
        app.default_window_icon()
            .map(|icon| {
                use tauri::image::Image;
                Image::new_owned(icon.rgba().to_owned(), icon.width(), icon.height())
            })
            .ok_or_else(|| "No icon available".to_string())
    })?;

    let tray_menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(
                app,
                "tray-quick-search",
                "Quick Search…",
                true,
                None::<&str>,
            )
            .map_err(|e| e.to_string())?,
            &MenuItem::with_id(app, "tray-show-main", "Show Aetherium", true, None::<&str>)
                .map_err(|e| e.to_string())?,
            &PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?,
            &MenuItem::with_id(app, "tray-quit", "Quit", true, None::<&str>)
                .map_err(|e| e.to_string())?,
        ],
    )
    .map_err(|e| e.to_string())?;

    let builder = TrayIconBuilder::with_id("aetherium-tray")
        .icon(icon)
        .tooltip("Aetherium")
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-quick-search" => {
                let _ = commands::quick_search::show_window(app);
            }
            "tray-show-main" => {
                let _ = commands::quick_search::show_main_window(app);
            }
            "tray-quit" => {
                app.exit(0);
            }
            _ => {}
        });

    #[cfg(not(target_os = "linux"))]
    let builder = builder.on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } = event
        {
            let _ = commands::quick_search::show_window(tray.app_handle());
        }
    });

    builder.build(app).map_err(|e| e.to_string())?;

    Ok(())
}

fn load_tray_icon(app: &AppHandle) -> Result<tauri::image::Image<'static>, String> {
    // Get the menubar icon style from settings (default to monochrome)
    let icon_style = {
        let db_state = app.state::<crate::db::DbState>();
        match db_state.0.get() {
            Ok(conn) => {
                commands::settings::get_setting(&conn, "menubar_icon_style")
                    .unwrap_or_else(|| "monochrome".to_string())
            }
            Err(_) => "monochrome".to_string(),
        }
    };

    // Try to load from resources (macOS only — icon files are bundled there)
    #[cfg(target_os = "macos")]
    {
        use tauri::image::Image;
        // Map icon style to filename
        let icon_filename = match icon_style.as_str() {
            "white" => "icon-white.png",
            "black" => "icon-black.png",
            "monochrome" | _ => "icon-monochrome.png",
        };
        if let Ok(resource_path) = app.path().resource_dir() {
            let icon_path = resource_path.join(icon_filename);
            if icon_path.exists() {
                let bytes = std::fs::read(&icon_path)
                    .map_err(|e| format!("Failed to read icon file: {}", e))?;
                let img = image::load_from_memory(&bytes)
                    .map_err(|e| format!("Failed to decode icon: {}", e))?
                    .into_rgba8();
                let (width, height) = img.dimensions();
                return Ok(Image::new_owned(img.into_raw(), width, height));
            }
        }
    }

    // Fallback: create a basic icon dynamically
    create_monochrome_tray_icon(&icon_style)
}

fn create_monochrome_tray_icon(style: &str) -> Result<tauri::image::Image<'static>, String> {
    // Create a 22x22 PNG icon in memory
    // For now, we'll use a simple RGB implementation
    const SIZE: usize = 22;
    const STRIDE: usize = SIZE * 4; // RGBA
    let mut rgba_data = vec![0u8; STRIDE * SIZE];

    // Determine the color based on style
    let (r, g, b) = match style {
        "white" => (255u8, 255u8, 255u8),
        "black" => (0u8, 0u8, 0u8),
        _ => (0u8, 0u8, 0u8), // Default to black (will invert on dark menubar)
    };

    // Draw a simple circle in the center
    let center = SIZE as i32 / 2;
    let radius = SIZE as i32 / 3;

    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = (x as i32) - center;
            let dy = (y as i32) - center;
            let dist_sq = dx * dx + dy * dy;

            if dist_sq <= radius * radius {
                let idx = (y * SIZE + x) * 4;
                rgba_data[idx] = r;
                rgba_data[idx + 1] = g;
                rgba_data[idx + 2] = b;
                rgba_data[idx + 3] = 255; // Alpha
            }
        }
    }

    Ok(tauri::image::Image::new_owned(rgba_data, SIZE as u32, SIZE as u32))
}
