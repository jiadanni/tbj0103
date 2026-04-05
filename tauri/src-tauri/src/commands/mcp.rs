use crate::mcp_client::MCPClientManager;
use crate::models::mcp::{MCPResource, MCPResourceTemplate, MCPServerConfig, MCPTool};
use serde_json::Value;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

#[tauri::command]
pub async fn list_mcp_servers(
    mcp_manager: State<'_, Arc<Mutex<MCPClientManager>>>,
) -> Result<Vec<MCPServerConfig>, String> {
    let manager = mcp_manager.lock().await;
    Ok(manager
        .configs
        .values()
        .map(|config| MCPServerConfig {
            id: uuid::Uuid::new_v4().to_string(),
            name: config.name.clone(),
            command: config.command.clone(),
            args: config.args.clone(),
            enabled: config.enabled,
            workspace_id: config.workspace_id.clone(),
            created_at: chrono::Utc::now().to_rfc3339(),
        })
        .collect())
}

#[tauri::command]
pub async fn add_mcp_server(
    mcp_manager: State<'_, Arc<Mutex<MCPClientManager>>>,
    name: String,
    command: String,
    args: Vec<String>,
    workspace_id: String,
) -> Result<MCPServerConfig, String> {
    let mut manager = mcp_manager.lock().await;
    let config = crate::mcp_client::MCPServerConfig {
        name: name.clone(),
        command: command.clone(),
        args: args.clone(),
        enabled: true,
        workspace_id: workspace_id.clone(),
    };
    manager.add_server(config)?;

    Ok(MCPServerConfig {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        command,
        args,
        enabled: true,
        workspace_id,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub async fn update_mcp_server(
    mcp_manager: State<'_, Arc<Mutex<MCPClientManager>>>,
    name: String,
    command: String,
    args: Vec<String>,
    enabled: bool,
) -> Result<(), String> {
    let mut manager = mcp_manager.lock().await;
    let existing = manager
        .get_server(&name)
        .ok_or_else(|| format!("Server {} not found", name))?;

    let updated_config = crate::mcp_client::MCPServerConfig {
        name: name.clone(),
        command,
        args,
        enabled,
        workspace_id: existing.workspace_id,
    };

    manager.update_server(updated_config)?;
    Ok(())
}

#[tauri::command]
pub async fn delete_mcp_server(
    mcp_manager: State<'_, Arc<Mutex<MCPClientManager>>>,
    name: String,
) -> Result<(), String> {
    let mut manager = mcp_manager.lock().await;
    manager.delete_server(&name)
}

#[tauri::command]
pub async fn mcp_list_tools(
    mcp_manager: State<'_, Arc<Mutex<MCPClientManager>>>,
    server_name: String,
) -> Result<Vec<MCPTool>, String> {
    let manager = mcp_manager.lock().await;
    let _config = manager
        .get_server(&server_name)
        .ok_or_else(|| format!("Server {} not found", server_name))?;

    // In a full implementation, this would spawn the server process
    // and query it for available tools
    // For now, return empty list as placeholder
    Ok(vec![])
}

#[tauri::command]
pub async fn mcp_list_resources(
    mcp_manager: State<'_, Arc<Mutex<MCPClientManager>>>,
    server_name: String,
) -> Result<(Vec<MCPResource>, Vec<MCPResourceTemplate>), String> {
    let manager = mcp_manager.lock().await;
    let _config = manager
        .get_server(&server_name)
        .ok_or_else(|| format!("Server {} not found", server_name))?;

    // In a full implementation, this would spawn the server process
    // and query it for available resources
    // For now, return empty lists as placeholders
    Ok((vec![], vec![]))
}

#[tauri::command]
pub async fn mcp_call_tool(
    mcp_manager: State<'_, Arc<Mutex<MCPClientManager>>>,
    server_name: String,
    tool_name: String,
    arguments: Value,
) -> Result<String, String> {
    let manager = mcp_manager.lock().await;
    let _config = manager
        .get_server(&server_name)
        .ok_or_else(|| format!("Server {} not found", server_name))?;

    // In a full implementation, this would spawn the server process
    // and invoke the tool via JSON-RPC
    // For now, return a placeholder response
    Ok(format!(
        "Tool {} on server {} called with args: {}",
        tool_name, server_name, arguments
    ))
}

#[tauri::command]
pub async fn mcp_read_resource(
    mcp_manager: State<'_, Arc<Mutex<MCPClientManager>>>,
    server_name: String,
    uri: String,
) -> Result<String, String> {
    let manager = mcp_manager.lock().await;
    let _config = manager
        .get_server(&server_name)
        .ok_or_else(|| format!("Server {} not found", server_name))?;

    // In a full implementation, this would spawn the server process
    // and fetch the resource via JSON-RPC
    // For now, return a placeholder response
    Ok(format!("Resource {} from server {}", uri, server_name))
}

#[tauri::command]
pub async fn mcp_connect_server(
    mcp_manager: State<'_, Arc<Mutex<MCPClientManager>>>,
    server_name: String,
) -> Result<(), String> {
    let manager = mcp_manager.lock().await;
    let _config = manager
        .get_server(&server_name)
        .ok_or_else(|| format!("Server {} not found", server_name))?;

    // In a full implementation, this would establish a connection to the server
    // For now, just verify it exists
    Ok(())
}

#[tauri::command]
pub async fn mcp_disconnect_server(
    _mcp_manager: State<'_, Arc<Mutex<MCPClientManager>>>,
    _server_name: String,
) -> Result<(), String> {
    // In a full implementation, this would close the connection to the server
    // For now, just acknowledge
    Ok(())
}
