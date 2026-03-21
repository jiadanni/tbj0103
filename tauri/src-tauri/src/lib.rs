pub mod db;
pub mod models;
pub mod services;
pub mod commands;
pub mod ollama;
pub mod mcp_server;
pub mod mcp_client;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            // Initialize SQLite database
            let app_dir = app.path().app_data_dir()
                .expect("Failed to get app data directory");
            std::fs::create_dir_all(&app_dir)?;
            let db_path = app_dir.join("aetherium.db");
            let conn = db::initialize_database(&db_path)
                .expect("Failed to initialize database");

            // Resolve the chats directory and try to load encryption passphrase
            let chats_dir = app_dir.join("chats");
            let passphrase = commands::chat_file::load_crypto_state_from_keyring(&conn);

            app.manage(db::DbState(std::sync::Mutex::new(conn)));
            app.manage(commands::chat_file::ChatsDirState(chats_dir));
            app.manage(commands::chat_file::ChatCryptoState(
                std::sync::Mutex::new(passphrase),
            ));
            app.manage(commands::ollama::StreamAbortState(
                std::sync::Mutex::new(std::collections::HashMap::new()),
            ));

            // Initialize MCP Client Manager
            let mcp_manager = std::sync::Arc::new(tokio::sync::Mutex::new(
                mcp_client::MCPClientManager::new()
            ));
            app.manage(mcp_manager);
            
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
                        let conn = state.0.lock().unwrap();
                        let val: String = conn.query_row(
                            "SELECT value FROM settings WHERE key = 'topic_analysis_interval_minutes'",
                            [],
                            |row| row.get(0)
                        ).unwrap_or_else(|_| "30".to_string());
                        val.parse::<u64>().unwrap_or(30)
                    };

                    {
                        let db = app_handle.state::<db::DbState>();
                        let conn = db.0.lock().unwrap();

                        let workspace_ids: Vec<String> = conn
                            .prepare("SELECT id FROM workspaces")
                            .and_then(|mut stmt| {
                                stmt.query_map([], |row| row.get::<_, String>(0))?
                                    .collect::<Result<Vec<_>, _>>()
                            })
                            .unwrap_or_default();

                        for id in workspace_ids {
                            if let Ok((text, count)) = crate::services::topic_signature::collect_workspace_text(&conn, &id) {
                                if count > 0 {
                                    // Get existing to preserve manual/ignored
                                    let existing_json: String = conn.query_row(
                                        "SELECT topic_signature FROM workspaces WHERE id = ?1",
                                        rusqlite::params![id],
                                        |row| row.get(0),
                                    ).unwrap_or_else(|_| "{}".to_string());
                                    let existing: crate::models::workspace::TopicSignature = serde_json::from_str(&existing_json).unwrap_or_default();

                                    let mut sig = crate::services::topic_signature::generate_heuristic(&text);
                                    sig.message_count_at_gen = Some(count);
                                    sig.manual_tags = existing.manual_tags;
                                    sig.ignored_tags = existing.ignored_tags;

                                    if let Ok(sig_json) = serde_json::to_string(&sig) {
                                        let now = chrono::Utc::now().to_rfc3339();
                                        let _ = conn.execute(
                                            "UPDATE workspaces SET topic_signature = ?1, signature_updated_at = ?2 WHERE id = ?3",
                                            rusqlite::params![sig_json, now, id],
                                        );
                                    }
                                }
                            }
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
            commands::workspace::list_workspaces,
            commands::workspace::get_workspace,
            commands::workspace::update_workspace,
            commands::workspace::delete_workspace,
            // Project commands
            commands::project::create_project,
            commands::project::list_projects,
            commands::project::get_project,
            commands::project::update_project,
            commands::project::delete_project,
            // Artifact commands
            commands::artifact::create_artifact,
            commands::artifact::get_artifact,
            commands::artifact::list_artifacts,
            commands::artifact::update_artifact,
            commands::artifact::delete_artifact,
            commands::artifact::search_artifacts,
            // Context & Chat
            commands::context::assemble_and_send,
            commands::chat::create_chat_session,
            commands::chat::list_chat_sessions,
            commands::chat::get_chat_session,
            commands::chat::delete_chat_session,
            commands::chat::add_message,
            commands::chat::get_messages,
            commands::chat::list_deleted_chat_sessions,
            commands::chat::restore_chat_session,
            commands::chat::hard_delete_chat_session,
            commands::chat::empty_recycle_bin,
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
            commands::ollama::generate_title,
            commands::ollama::generate_title_from_conversation,
            commands::ollama::generate_embedding,
            commands::ollama::send_dual_model_message,
            commands::ollama::extract_topics,
            commands::ollama::generate_follow_ups,
            commands::ollama::stop_stream,
            // Export commands
            commands::export::export_markdown,
            commands::export::export_json,
            commands::export::export_obsidian_vault,
            // Backup commands
            commands::backup::create_backup,
            commands::backup::list_backups,
            commands::backup::restore_backup,
            commands::backup::delete_backup,
            // Settings commands
            commands::settings::get_settings,
            commands::settings::update_settings,
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
            // Project stats
            commands::project::get_project_stats,
            // Web capture commands
            commands::web_capture::create_web_capture,
            commands::web_capture::list_web_captures,
            commands::web_capture::get_web_capture,
            commands::web_capture::delete_web_capture,
            commands::web_capture::update_web_capture,
            // AI model commands
            commands::ai_model::list_ai_models,
            commands::ai_model::add_ai_model,
            commands::ai_model::update_ai_model,
            commands::ai_model::delete_ai_model,
            commands::ai_model::get_default_model,
            commands::ai_model::record_model_token_usage,
            // AI knowledge commands
            commands::ai_knowledge::analyze_workspace,
            commands::ai_knowledge::suggest_learning_goals,
            // Memory commands
            commands::memory::create_memory,
            commands::memory::list_memories,
            commands::memory::update_memory,
            commands::memory::delete_memory,
            commands::memory::get_active_memories,
            commands::memory::extract_memories,
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
            commands::thought_queue::get_due_thoughts,
            commands::thought_queue::update_thought_status,
            commands::thought_queue::update_thought_result,
            commands::thought_queue::delete_thought,
            // Chat file / encryption commands
            commands::chat_file::get_chat_file_info,
            commands::chat_file::setup_chat_encryption,
            commands::chat_file::disable_chat_encryption,
            commands::chat_file::export_chat_as_json,
            commands::chat_file::import_chat_from_json,
            commands::chat_file::sync_all_chats_to_files,
            // Web AI (Playwright bridge)
            commands::web_ai::send_web_message,
            // Topic signatures
            commands::topic_signature::get_topic_signature,
            commands::topic_signature::regenerate_topic_signature,
            commands::topic_signature::update_topic_signature,
            commands::topic_signature::check_workspace_match,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
