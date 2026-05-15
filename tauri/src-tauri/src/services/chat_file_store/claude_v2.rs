// Claude Desktop v2 format parser (export format introduced 2026-05-14).
// Layout: projects/<uuid>.json per project, design_chats/<uuid>.json per project chat.
// conversations.json contains only orphan chats (no project link).

use std::collections::HashMap;
use std::path::Path;
use serde::Deserialize;

use super::{
    ChatFileData, ChatFileMessage,
    ClaudeConversationPreview, ClaudeProjectPreview,
    ClaudeMemoryPreview, ClaudeProjectMemoryPreview,
    extract_claude_message_content_v2,
};

// ── v2-specific structs ───────────────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub(super) struct V2Project {
    pub uuid: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub prompt_template: Option<String>,
    #[serde(default)]
    pub docs: Vec<V2Doc>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub(super) struct V2Doc {
    pub uuid: String,
    pub filename: String,
    pub content: String,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub(super) struct V2DesignChat {
    pub uuid: String,
    pub title: String,
    pub project: V2ChatProject,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub messages: Vec<V2Message>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub(super) struct V2ChatProject {
    pub uuid: String,
    pub name: String,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct V2Message {
    pub uuid: String,
    #[serde(default)]
    pub text: String,
    pub sender: String,
    #[serde(default)]
    pub content: Vec<V2ContentBlock>,
    pub created_at: String,
    #[serde(default)]
    pub attachments: Vec<V2Attachment>,
    #[serde(default)]
    pub files: Vec<serde_json::Value>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct V2ContentBlock {
    #[serde(rename = "type")]
    pub block_type: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub thinking: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub input: Option<serde_json::Value>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct V2Attachment {
    #[serde(default)]
    pub file_name: Option<String>,
    #[serde(default)]
    pub extracted_content: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct V2MemoryAccount {
    #[serde(default)]
    pub conversations_memory: String,
    /// v2 uses `project_memories` (dict uuid → text) instead of legacy `folder_memories`
    #[serde(default)]
    pub project_memories: HashMap<String, String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn v2_message_to_chat(msg: &V2Message) -> Option<ChatFileMessage> {
    let role = match msg.sender.as_str() {
        "human" => "user",
        "assistant" => "assistant",
        _ => return None,
    };
    let content = extract_claude_message_content_v2(msg);
    if content.is_empty() {
        return None;
    }
    Some(ChatFileMessage {
        id: msg.uuid.clone(),
        role: role.to_string(),
        content,
        model: if role == "assistant" {
            Some("claude".to_string())
        } else {
            None
        },
        tokens_used: None,
        duration_ms: None,
        timestamp: msg.created_at.clone(),
    })
}

fn design_chat_to_chat_data(chat: &V2DesignChat) -> Option<ChatFileData> {
    if chat.messages.is_empty() {
        return None;
    }
    let messages: Vec<ChatFileMessage> = chat.messages.iter().filter_map(v2_message_to_chat).collect();
    if messages.is_empty() {
        return None;
    }
    Some(ChatFileData {
        id: chat.uuid.clone(),
        title: chat.title.clone(),
        model: "claude".to_string(),
        system_prompt: String::new(),
        created_at: chat.created_at.clone(),
        updated_at: chat.updated_at.clone(),
        messages,
    })
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Read all `projects/<uuid>.json` files and return project previews.
/// Attaches `conversation_count` (from design_chats) and `has_memory` (from memories).
pub fn preview_v2_projects(
    folder_path: &Path,
    memory_uuids: &std::collections::HashSet<String>,
    convs_by_project: &HashMap<String, Vec<ClaudeConversationPreview>>,
) -> Result<Vec<ClaudeProjectPreview>, String> {
    let projects_dir = folder_path.join("projects");
    let entries = std::fs::read_dir(&projects_dir)
        .map_err(|e| format!("Cannot read projects/ directory: {e}"))?;

    let mut previews = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
        let project: V2Project = serde_json::from_slice(&bytes)
            .map_err(|e| format!("Invalid project JSON {}: {e}", path.display()))?;

        let conversation_count = convs_by_project
            .get(&project.uuid)
            .map(|v| v.len())
            .unwrap_or(0);

        previews.push(ClaudeProjectPreview {
            uuid: project.uuid.clone(),
            name: project.name,
            description: project.description.unwrap_or_default(),
            has_prompt: project.prompt_template.as_ref().is_some_and(|s| !s.is_empty()),
            doc_count: project.docs.len(),
            conversation_count,
            has_memory: memory_uuids.contains(&project.uuid),
        });
    }

    Ok(previews)
}

/// Read all `design_chats/<uuid>.json` files and group previews by project UUID.
pub fn preview_v2_design_chats(
    folder_path: &Path,
) -> Result<HashMap<String, Vec<ClaudeConversationPreview>>, String> {
    let chats_dir = folder_path.join("design_chats");
    if !chats_dir.exists() {
        return Ok(HashMap::new());
    }

    let entries = std::fs::read_dir(&chats_dir)
        .map_err(|e| format!("Cannot read design_chats/ directory: {e}"))?;

    let mut by_project: HashMap<String, Vec<ClaudeConversationPreview>> = HashMap::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
        let chat: V2DesignChat = serde_json::from_slice(&bytes)
            .map_err(|e| format!("Invalid design_chat JSON {}: {e}", path.display()))?;

        if chat.messages.is_empty() {
            continue;
        }

        let preview = ClaudeConversationPreview {
            uuid: chat.uuid.clone(),
            name: chat.title.clone(),
            message_count: chat.messages.len(),
            created_at: chat.created_at.clone(),
            updated_at: chat.updated_at.clone(),
            project_uuid: Some(chat.project.uuid.clone()),
        };
        by_project.entry(chat.project.uuid).or_default().push(preview);
    }

    Ok(by_project)
}

/// Parse memories.json for the v2 format (uses `project_memories` key).
/// Returns the set of project UUIDs that have non-empty memory, plus a full ClaudeMemoryPreview.
pub fn parse_v2_memories(
    folder_path: &Path,
    project_name_map: &HashMap<String, String>,
) -> Result<(std::collections::HashSet<String>, ClaudeMemoryPreview), String> {
    let mem_path = folder_path.join("memories.json");
    if !mem_path.exists() {
        return Ok((std::collections::HashSet::new(), ClaudeMemoryPreview {
            conversations_memory: String::new(),
            folder_memories: Vec::new(),
        }));
    }

    let bytes = std::fs::read(&mem_path).map_err(|e| format!("Cannot read memories.json: {e}"))?;
    let accounts: Vec<V2MemoryAccount> =
        serde_json::from_slice(&bytes).map_err(|e| format!("Invalid memories.json: {e}"))?;

    let account = accounts.into_iter().next().unwrap_or(V2MemoryAccount {
        conversations_memory: String::new(),
        project_memories: HashMap::new(),
    });

    let mut memory_uuids = std::collections::HashSet::new();
    let mut folder_memories = Vec::new();

    for (uuid, memory) in &account.project_memories {
        if memory.trim().is_empty() {
            continue;
        }
        memory_uuids.insert(uuid.clone());
        let folder_name = project_name_map
            .get(uuid)
            .cloned()
            .unwrap_or_else(|| format!("Unknown project ({uuid})"));
        folder_memories.push(ClaudeProjectMemoryPreview {
            project_uuid: uuid.clone(),
            folder_name,
            memory: memory.clone(),
        });
    }

    Ok((memory_uuids, ClaudeMemoryPreview {
        conversations_memory: account.conversations_memory,
        folder_memories,
    }))
}

/// Parse all `design_chats/<uuid>.json` filtered to `selected_ids`.
/// Returns (ChatFileData, project_uuid) pairs.
pub fn parse_v2_design_chats_filtered(
    folder_path: &Path,
    selected_ids: &[String],
) -> Result<Vec<(ChatFileData, Option<String>)>, String> {
    let chats_dir = folder_path.join("design_chats");
    if !chats_dir.exists() {
        return Ok(Vec::new());
    }

    let id_set: std::collections::HashSet<&str> = selected_ids.iter().map(|s| s.as_str()).collect();
    let entries = std::fs::read_dir(&chats_dir)
        .map_err(|e| format!("Cannot read design_chats/ directory: {e}"))?;

    let mut results = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
        let chat: V2DesignChat = match serde_json::from_slice(&bytes) {
            Ok(c) => c,
            Err(_) => continue,
        };
        if !id_set.is_empty() && !id_set.contains(chat.uuid.as_str()) {
            continue;
        }
        if let Some(data) = design_chat_to_chat_data(&chat) {
            results.push((data, Some(chat.project.uuid)));
        }
    }

    Ok(results)
}

/// Read `projects/` directory and return a uuid→name map (for memory resolution).
pub fn load_v2_project_name_map(folder_path: &Path) -> HashMap<String, String> {
    let projects_dir = folder_path.join("projects");
    let Ok(entries) = std::fs::read_dir(&projects_dir) else {
        return HashMap::new();
    };
    let mut map = HashMap::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(bytes) = std::fs::read(&path) {
            if let Ok(p) = serde_json::from_slice::<V2Project>(&bytes) {
                map.insert(p.uuid, p.name);
            }
        }
    }
    map
}
