use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPServerConfig {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub enabled: bool,
    pub workspace_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPTool {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPResource {
    pub uri: String,
    pub name: String,
    pub description: Option<String>,
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPResourceTemplate {
    pub uri_template: String,
    pub name: String,
    pub description: Option<String>,
    pub mime_type: Option<String>,
}

pub struct MCPClientManager {
    // In a full implementation, this would hold active connections
    // For now, just store configurations
    pub configs: HashMap<String, MCPServerConfig>,
}

impl MCPClientManager {
    pub fn new() -> Self {
        Self {
            configs: HashMap::new(),
        }
    }

    pub fn add_server(&mut self, config: MCPServerConfig) -> Result<(), String> {
        if self.configs.contains_key(&config.name) {
            return Err(format!("Server {} already exists", config.name));
        }
        self.configs.insert(config.name.clone(), config);
        Ok(())
    }

    pub fn update_server(&mut self, config: MCPServerConfig) -> Result<(), String> {
        if !self.configs.contains_key(&config.name) {
            return Err(format!("Server {} not found", config.name));
        }
        self.configs.insert(config.name.clone(), config);
        Ok(())
    }

    pub fn delete_server(&mut self, name: &str) -> Result<(), String> {
        self.configs
            .remove(name)
            .ok_or_else(|| format!("Server {} not found", name))?;
        Ok(())
    }

    pub fn list_servers(&self) -> Vec<MCPServerConfig> {
        self.configs.values().cloned().collect()
    }

    pub fn get_server(&self, name: &str) -> Option<MCPServerConfig> {
        self.configs.get(name).cloned()
    }
}

impl Default for MCPClientManager {
    fn default() -> Self {
        Self::new()
    }
}
