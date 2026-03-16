pub mod db;
pub mod models;
pub mod services;
pub mod commands;
pub mod ollama;

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
            app.manage(db::DbState(std::sync::Mutex::new(conn)));
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
            // Chat commands
            commands::chat::create_chat_session,
            commands::chat::list_chat_sessions,
            commands::chat::get_chat_session,
            commands::chat::delete_chat_session,
            commands::chat::add_message,
            commands::chat::get_messages,
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
            commands::ollama::generate_embedding,
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
            // Project stats
            commands::project::get_project_stats,
            // Web capture commands
            commands::web_capture::create_web_capture,
            commands::web_capture::list_web_captures,
            commands::web_capture::get_web_capture,
            commands::web_capture::delete_web_capture,
            commands::web_capture::update_web_capture,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
