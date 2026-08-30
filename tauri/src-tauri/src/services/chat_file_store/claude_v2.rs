// Claude Desktop v2 format parser (export format introduced 2026-05-14).
// Layout: projects/<uuid>.json per project, design_chats/<uuid>.json per project chat.
// conversations.json contains only orphan chats (no project link).

use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;

use super::{
    extract_claude_message_content_v2, ChatFileData, ChatFileMessage, ClaudeConversationPreview,
    ClaudeMemoryPreview, ClaudeProjectMemoryPreview, ClaudeProjectPreview,
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
    /// v3 only: Claude's markdown memory directory (`/profile.md`, `/topics/*.md`, …).
    /// Absent in v2 exports.
    #[serde(default)]
    pub memory_files: Vec<V2MemoryFile>,
}

/// A single markdown memory file from a v3 export's `memory_files` array.
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct V2MemoryFile {
    pub path: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub updated_at: Option<String>,
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
    let messages: Vec<ChatFileMessage> = chat
        .messages
        .iter()
        .filter_map(v2_message_to_chat)
        .collect();
    if messages.is_empty() {
        return None;
    }
    Some(ChatFileData {
        id: chat.uuid.clone(),
        title: super::claude_title_or_fallback(&chat.title, &messages),
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
        let bytes =
            std::fs::read(&path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
        let project: V2Project = serde_json::from_slice(&bytes)
            .map_err(|e| format!("Invalid project JSON {}: {e}", path.display()))?;

        let conversation_count = convs_by_project
            .get(&project.uuid)
            .map(|v| v.len())
            .unwrap_or(0);

        let prompt = project.prompt_template.unwrap_or_default();
        previews.push(ClaudeProjectPreview {
            uuid: project.uuid.clone(),
            name: project.name,
            description: project.description.unwrap_or_default(),
            has_prompt: !prompt.is_empty(),
            doc_count: project.docs.len(),
            conversation_count,
            has_memory: memory_uuids.contains(&project.uuid),
            prompt_template: prompt,
        });
    }

    Ok(previews)
}

/// Read all `design_chats/<uuid>.json` files and group previews by project
/// UUID. Also returns the number of chats skipped for having no importable
/// content (empty, or all messages contentless in the export itself).
pub fn preview_v2_design_chats(
    folder_path: &Path,
) -> Result<(HashMap<String, Vec<ClaudeConversationPreview>>, usize), String> {
    let chats_dir = folder_path.join("design_chats");
    if !chats_dir.exists() {
        return Ok((HashMap::new(), 0));
    }

    let entries = std::fs::read_dir(&chats_dir)
        .map_err(|e| format!("Cannot read design_chats/ directory: {e}"))?;

    let mut by_project: HashMap<String, Vec<ClaudeConversationPreview>> = HashMap::new();
    let mut skipped_empty = 0usize;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let bytes =
            std::fs::read(&path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
        let chat: V2DesignChat = serde_json::from_slice(&bytes)
            .map_err(|e| format!("Invalid design_chat JSON {}: {e}", path.display()))?;

        // Same rule as the import path (v2_message_to_chat): keep only chats
        // with at least one human/assistant message with real content.
        let has_content = chat.messages.iter().any(|m| {
            matches!(m.sender.as_str(), "human" | "assistant")
                && !extract_claude_message_content_v2(m).is_empty()
        });
        if !has_content {
            skipped_empty += 1;
            continue;
        }

        let first_user_message = chat
            .messages
            .iter()
            .find(|m| m.sender == "human")
            .map(|m| {
                let raw = extract_claude_message_content_v2(m);
                let mut out = String::new();
                for (i, ch) in raw.chars().enumerate() {
                    if i >= 280 {
                        break;
                    }
                    out.push(ch);
                }
                out
            })
            .unwrap_or_default();
        let messages = chat
            .messages
            .iter()
            .map(|m| {
                let role = if m.sender == "human" {
                    "user"
                } else {
                    "assistant"
                }
                .to_string();
                let content = extract_claude_message_content_v2(m);
                super::ClaudeMessagePreview { role, content }
            })
            .collect();
        let preview = ClaudeConversationPreview {
            uuid: chat.uuid.clone(),
            name: chat.title.clone(),
            message_count: chat.messages.len(),
            created_at: chat.created_at.clone(),
            updated_at: chat.updated_at.clone(),
            project_uuid: Some(chat.project.uuid.clone()),
            first_user_message,
            // Design chats are already project-linked; they never go through
            // the matcher, so no summary is needed.
            summary: String::new(),
            messages,
        };
        by_project
            .entry(chat.project.uuid)
            .or_default()
            .push(preview);
    }

    Ok((by_project, skipped_empty))
}

/// Where an export keeps its memories.
///
/// v2 shipped a top-level `memories.json` holding a one-element array; v3 (the
/// 2026-08-30 export) ships `memories/<account-uuid>.json` holding a bare object.
/// Both decode into the same [`V2MemoryAccount`].
pub enum MemoriesSource {
    /// v2: `memories.json`, a JSON array of accounts.
    LegacyFile(std::path::PathBuf),
    /// v3: `memories/<uuid>.json`, one bare account object per file.
    Directory(Vec<std::path::PathBuf>),
}

/// Locate an export's memories, whichever layout it uses.
///
/// Returns `None` only when neither layout is present — which callers must treat
/// as "this export has no memories", distinct from "we looked in the wrong place".
pub fn find_memories_source(folder_path: &Path) -> Option<MemoriesSource> {
    let dir = folder_path.join("memories");
    if dir.is_dir() {
        let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(&dir)
            .ok()?
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_file() && p.extension().is_some_and(|x| x == "json"))
            .collect();
        if !files.is_empty() {
            // Stable order so a multi-account export parses deterministically.
            files.sort();
            return Some(MemoriesSource::Directory(files));
        }
    }

    let legacy = folder_path.join("memories.json");
    if legacy.is_file() {
        return Some(MemoriesSource::LegacyFile(legacy));
    }

    None
}

/// Read and decode the export's memory account, handling both the v2 array file
/// and the v3 per-account directory.
fn read_v2_memory_account(folder_path: &Path) -> Result<Option<V2MemoryAccount>, String> {
    match find_memories_source(folder_path) {
        None => Ok(None),

        Some(MemoriesSource::LegacyFile(path)) => {
            let bytes =
                std::fs::read(&path).map_err(|e| format!("Cannot read memories.json: {e}"))?;
            let accounts: Vec<V2MemoryAccount> =
                serde_json::from_slice(&bytes).map_err(|e| format!("Invalid memories.json: {e}"))?;
            Ok(accounts.into_iter().next())
        }

        Some(MemoriesSource::Directory(files)) => {
            // Take the first file that decodes. A malformed file is reported
            // rather than silently skipped — losing memories quietly is the
            // exact failure this function exists to prevent.
            let mut first_err = None;
            for path in &files {
                let bytes = std::fs::read(path)
                    .map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
                match serde_json::from_slice::<V2MemoryAccount>(&bytes) {
                    Ok(account) => return Ok(Some(account)),
                    Err(e) => {
                        first_err.get_or_insert(format!("Invalid {}: {e}", path.display()));
                    }
                }
            }
            match first_err {
                Some(e) => Err(e),
                None => Ok(None),
            }
        }
    }
}

/// Parse an export's memories (uses the `project_memories` key).
/// Returns the set of project UUIDs that have non-empty memory, plus a full ClaudeMemoryPreview.
pub fn parse_v2_memories(
    folder_path: &Path,
    project_name_map: &HashMap<String, String>,
) -> Result<(std::collections::HashSet<String>, ClaudeMemoryPreview), String> {
    let Some(account) = read_v2_memory_account(folder_path)? else {
        return Ok((
            std::collections::HashSet::new(),
            ClaudeMemoryPreview {
                conversations_memory: String::new(),
                folder_memories: Vec::new(),
            },
        ));
    };

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

    Ok((
        memory_uuids,
        ClaudeMemoryPreview {
            conversations_memory: account.conversations_memory,
            folder_memories,
        },
    ))
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
        let bytes =
            std::fs::read(&path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// v3 (2026-08-30): memories/<uuid>.json holding a bare object.
    #[test]
    fn parses_v3_memories_directory() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("memories")).unwrap();
        std::fs::write(
            dir.path().join("memories").join("acct-uuid.json"),
            r#"{
                "conversations_memory": "top level memory",
                "project_memories": {"p1": "memory for p1", "p2": "   "},
                "memory_files": [{"path": "/profile.md", "content": "hi", "updated_at": "2026-08-24T19:55:22Z"}],
                "account_uuid": "acct-uuid"
            }"#,
        )
        .unwrap();

        let mut names = HashMap::new();
        names.insert("p1".to_string(), "Project One".to_string());

        let (uuids, preview) = parse_v2_memories(dir.path(), &names).unwrap();

        assert_eq!(preview.conversations_memory, "top level memory");
        // p2 is whitespace-only and must be skipped.
        assert_eq!(uuids.len(), 1);
        assert!(uuids.contains("p1"));
        assert_eq!(preview.folder_memories.len(), 1);
        assert_eq!(preview.folder_memories[0].folder_name, "Project One");
    }

    /// v2: a top-level memories.json holding a one-element array.
    #[test]
    fn parses_v2_memories_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("memories.json"),
            r#"[{"conversations_memory": "legacy mem", "project_memories": {"p1": "m"}}]"#,
        )
        .unwrap();

        let (uuids, preview) = parse_v2_memories(dir.path(), &HashMap::new()).unwrap();
        assert_eq!(preview.conversations_memory, "legacy mem");
        assert!(uuids.contains("p1"));
    }

    /// The v3 directory must win when both layouts somehow coexist.
    #[test]
    fn prefers_v3_directory_over_legacy_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("memories")).unwrap();
        std::fs::write(
            dir.path().join("memories").join("a.json"),
            r#"{"conversations_memory": "from dir", "project_memories": {}}"#,
        )
        .unwrap();
        std::fs::write(
            dir.path().join("memories.json"),
            r#"[{"conversations_memory": "from file", "project_memories": {}}]"#,
        )
        .unwrap();

        let (_, preview) = parse_v2_memories(dir.path(), &HashMap::new()).unwrap();
        assert_eq!(preview.conversations_memory, "from dir");
    }

    /// No memories at all is a legitimate empty result, not an error.
    #[test]
    fn absent_memories_yields_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert!(find_memories_source(dir.path()).is_none());
        let (uuids, preview) = parse_v2_memories(dir.path(), &HashMap::new()).unwrap();
        assert!(uuids.is_empty());
        assert!(preview.folder_memories.is_empty());
    }

    /// A corrupt memories file must fail loudly rather than silently importing
    /// zero memories — the exact regression this module guards against.
    #[test]
    fn malformed_v3_memories_errors() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("memories")).unwrap();
        std::fs::write(dir.path().join("memories").join("a.json"), "{not json").unwrap();
        assert!(parse_v2_memories(dir.path(), &HashMap::new()).is_err());
    }
}

/// Read the export's account-level memory files (v3 `memory_files`).
///
/// Separate from [`parse_v2_memories`], which returns project memory: these
/// belong to no project and land in the `memories` table at global scope.
/// v2 exports have no such data, so this returns an empty vec for them.
pub fn parse_v2_account_memories(
    folder_path: &Path,
) -> Result<Vec<super::account_memory::ImportedMemory>, String> {
    let Some(account) = read_v2_memory_account(folder_path)? else {
        return Ok(Vec::new());
    };
    let files: Vec<(String, String, Option<String>)> = account
        .memory_files
        .into_iter()
        .map(|f| (f.path, f.content, f.updated_at))
        .collect();
    Ok(super::account_memory::parse_claude_account_memories(&files))
}

#[cfg(test)]
mod account_memory_sample_tests {
    /// Fixture check against a real v3 export; skipped when the env var is unset.
    #[test]
    fn parses_account_memories_from_sample() {
        let Some(path) = std::env::var_os("AETHERIUM_CLAUDE_V2_SAMPLE").map(std::path::PathBuf::from)
        else {
            eprintln!("skipping: set AETHERIUM_CLAUDE_V2_SAMPLE");
            return;
        };
        let mems = super::parse_v2_account_memories(&path).unwrap();
        eprintln!("account memories parsed: {}", mems.len());
        for m in mems.iter().take(4) {
            eprintln!("  [{}] {} / {} — {}", m.kind.as_db_value(), m.category, m.label, m.content);
        }
        assert!(!mems.is_empty(), "sample should yield account memories");
        assert!(mems.iter().all(|m| !m.content.trim().is_empty()));
        // Keys must be unique or re-import matching would collapse rows.
        let mut keys: Vec<&str> = mems.iter().map(|m| m.key.as_str()).collect();
        keys.sort_unstable();
        let before = keys.len();
        keys.dedup();
        assert_eq!(before, keys.len(), "keys must be unique");
    }
}

#[cfg(test)]
mod has_memory_tests {
    use std::collections::HashMap;

    /// `has_memory` must describe the export, not the user's include choice.
    ///
    /// Regression: preview_claude_files only parsed memories when the Memories
    /// toggle was on, so every project reported has_memory = false with it off
    /// and the UI claimed "(none in export)" for projects that plainly had it.
    #[test]
    fn memory_uuids_are_independent_of_include_flag() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("projects")).unwrap();
        std::fs::write(
            dir.path().join("projects").join("p1.json"),
            r#"{"uuid":"p1","name":"Beach stage","docs":[]}"#,
        )
        .unwrap();
        std::fs::create_dir(dir.path().join("memories")).unwrap();
        std::fs::write(
            dir.path().join("memories").join("acct.json"),
            r#"{"conversations_memory":"","project_memories":{"p1":"real memory text"}}"#,
        )
        .unwrap();

        let names = super::load_v2_project_name_map(dir.path());
        let (uuids, _) = super::parse_v2_memories(dir.path(), &names).unwrap();
        assert!(uuids.contains("p1"), "project memory must be detected");

        let projects = super::preview_v2_projects(dir.path(), &uuids, &HashMap::new()).unwrap();
        assert_eq!(projects.len(), 1);
        assert!(
            projects[0].has_memory,
            "has_memory must be true whenever the export carries memory"
        );
    }
}

#[cfg(test)]
mod has_memory_sample_tests {
    #[test]
    fn sample_projects_report_memory() {
        let Some(path) = std::env::var_os("AETHERIUM_CLAUDE_V2_SAMPLE").map(std::path::PathBuf::from)
        else {
            return;
        };
        let names = super::load_v2_project_name_map(&path);
        let (uuids, _) = super::parse_v2_memories(&path, &names).unwrap();
        let projects =
            super::preview_v2_projects(&path, &uuids, &std::collections::HashMap::new()).unwrap();
        let with = projects.iter().filter(|p| p.has_memory).count();
        eprintln!("projects: {}, with memory: {}", projects.len(), with);
        for p in projects.iter().filter(|p| p.has_memory).take(3) {
            eprintln!("  has_memory: {}", p.name);
        }
        assert!(with > 0, "sample export should have projects with memory");
    }
}

#[cfg(test)]
mod timing_probe {
    /// Measure each preview stage so the "split the preview" decision is made
    /// against numbers rather than impressions. Prints only; no assertions.
    #[test]
    fn stage_timings() {
        let Some(path) = std::env::var_os("AETHERIUM_CLAUDE_V2_SAMPLE").map(std::path::PathBuf::from)
        else {
            return;
        };
        let t = std::time::Instant::now();
        let names = super::load_v2_project_name_map(&path);
        eprintln!("project name map: {}ms", t.elapsed().as_millis());

        let t = std::time::Instant::now();
        let (uuids, _) = super::parse_v2_memories(&path, &names).unwrap();
        eprintln!("memories:         {}ms", t.elapsed().as_millis());

        let t = std::time::Instant::now();
        let (by_proj, _) = super::preview_v2_design_chats(&path).unwrap();
        eprintln!("design chats:     {}ms", t.elapsed().as_millis());

        let t = std::time::Instant::now();
        let projects = super::preview_v2_projects(&path, &uuids, &by_proj).unwrap();
        eprintln!("projects ({}):    {}ms", projects.len(), t.elapsed().as_millis());

        let t = std::time::Instant::now();
        let bytes = std::fs::read(path.join("conversations.json")).unwrap();
        eprintln!("read convs file:  {}ms ({} MB)", t.elapsed().as_millis(), bytes.len() / 1_048_576);

        let t = std::time::Instant::now();
        let (orphans, _) = super::super::preview_claude_conversations(&bytes).unwrap();
        eprintln!("parse convs ({}): {}ms", orphans.len(), t.elapsed().as_millis());
    }
}
