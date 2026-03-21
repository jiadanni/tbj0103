use std::path::PathBuf;
use std::env;
use std::io::{self, BufRead, Write};
use serde_json::json;

// Import from library
use aetherium_lib::db;
use aetherium_lib::mcp_server::{MCPService, tools, JsonRpcRequest, JsonRpcResponse, JsonRpcError};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Get database path from environment or use default
    let db_path = env::var("AETHERIUM_DB_PATH")
        .unwrap_or_else(|_| {
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
            home.join(".aetherium/aetherium.db")
                .to_string_lossy()
                .to_string()
        });

    // Initialize database
    let db_path_buf = PathBuf::from(&db_path);
    if let Some(parent) = db_path_buf.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let conn = db::initialize_database(&db_path_buf)?;
    let db_state = db::DbState(std::sync::Mutex::new(conn));
    let db_state = std::sync::Arc::new(db_state);

    // Create MCP service
    let _service = MCPService::new(db_state);

    // Log startup to stderr (keep stdout clean for JSON-RPC)
    eprintln!("Aetherium MCP Server started");
    eprintln!("Database: {}", db_path);
    eprintln!("Listening on stdio...");

    // Read JSON-RPC requests from stdin
    let stdin = io::stdin();
    let reader = stdin.lock();

    for line in reader.lines().map_while(Result::ok) {
        if let Ok(request) = serde_json::from_str::<JsonRpcRequest>(&line) {
            eprintln!("Received request: {}", request.method);

            let response = match request.method.as_str() {
                "tools/list" => {
                    let tools = vec![
                        tools::search_notes_tool(),
                        tools::list_due_flashcards_tool(),
                        tools::get_concept_neighbors_tool(),
                        tools::get_learning_goal_progress_tool(),
                        tools::search_chat_messages_tool(),
                        tools::get_workspace_stats_tool(),
                    ];
                    JsonRpcResponse {
                        jsonrpc: "2.0".to_string(),
                        id: request.id,
                        result: Some(json!({ "tools": tools })),
                        error: None,
                    }
                }
                _ => JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id: request.id,
                    result: None,
                    error: Some(JsonRpcError {
                        code: -32601,
                        message: format!("Method not found: {}", request.method),
                        data: None,
                    }),
                }
            };

            if let Ok(json) = serde_json::to_string(&response) {
                println!("{}", json);
                let _ = std::io::stdout().flush();
            }
        }
    }

    Ok(())
}
