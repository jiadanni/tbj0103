//! DeepSeek export parser.
//!
//! A DeepSeek data export is a folder holding `conversations.json` (and a
//! `user.json` we ignore). Each conversation stores its messages as a tree in
//! `mapping`: a synthetic `root` node, then one node per turn whose `message`
//! carries typed `fragments` (`REQUEST`, `RESPONSE`, `THINK`, `SEARCH`, `FILE`).
//! Editing a prompt or regenerating a reply forks the tree, so a conversation
//! can have several leaves.
//!
//! Every root-to-leaf path is imported: the most recently active path becomes
//! the primary chat, and each other path becomes a branch chat linked back to
//! it via `parent_session_id` / `branch_message_id` — the same shape the app
//! produces when a user branches a chat in-app.

use super::import_links;
use super::{import_chat_data_linked, ChatFileData, ChatFileMessage};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

/// `import_source_links.source` value for DeepSeek exports.
pub const SOURCE_DEEPSEEK: &str = "deepseek";

#[derive(Debug, Clone, Deserialize)]
pub struct DeepSeekConversation {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub inserted_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub mapping: HashMap<String, DeepSeekNode>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeepSeekNode {
    pub id: String,
    #[serde(default)]
    pub parent: Option<String>,
    #[serde(default)]
    pub children: Vec<String>,
    #[serde(default)]
    pub message: Option<DeepSeekMessage>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeepSeekMessage {
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub inserted_at: Option<String>,
    pub fragments: Vec<DeepSeekFragment>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeepSeekFragment {
    #[serde(rename = "type")]
    pub fragment_type: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub results: Option<Vec<DeepSeekSearchResult>>,
    #[serde(default)]
    pub files: Option<Vec<DeepSeekFile>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeepSeekSearchResult {
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeepSeekFile {
    #[serde(default)]
    pub file_name: Option<String>,
}

/// An alternate path through a conversation, imported as a branch chat.
#[derive(Debug, Clone)]
pub struct DeepSeekBranch {
    /// Stable key for re-import detection: `<conversation id>#<leaf node id>`.
    pub source_key: String,
    /// Full path from the first message to this branch's leaf.
    pub data: ChatFileData,
    /// Index into the primary chat's messages where this branch diverges —
    /// the primary message at this index becomes `branch_message_id`.
    pub diverge_index: usize,
}

#[derive(Debug, Clone)]
pub struct ParsedDeepSeekConversation {
    pub primary: ChatFileData,
    pub branches: Vec<DeepSeekBranch>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeepSeekPreviewMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeepSeekConversationPreview {
    pub uuid: String,
    pub name: String,
    pub message_count: usize,
    pub created_at: String,
    pub updated_at: String,
    pub first_user_message: String,
    pub messages: Vec<DeepSeekPreviewMessage>,
    pub branch_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeepSeekPreviewResponse {
    pub conversations: Vec<DeepSeekConversationPreview>,
    pub total: usize,
    /// Conversations that parsed but held no importable messages.
    pub skipped_empty: usize,
}

/// Locate `conversations.json` in a DeepSeek export folder.
pub fn discover_deepseek_file(folder: &Path) -> Result<PathBuf, String> {
    let path = folder.join("conversations.json");
    if path.is_file() {
        Ok(path)
    } else {
        Err("No conversations.json found in the selected folder.".to_string())
    }
}

/// Read and deserialize a DeepSeek `conversations.json`.
pub fn load_deepseek_conversations(path: &Path) -> Result<Vec<DeepSeekConversation>, String> {
    let bytes =
        std::fs::read(path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    serde_json::from_slice(&bytes).map_err(|e| {
        format!(
            "{} is not a DeepSeek export ({e}). Select the unzipped DeepSeek data folder.",
            path.display()
        )
    })
}

/// Normalize a DeepSeek timestamp (`2025-10-17T19:14:01.108000+08:00`) to UTC RFC 3339.
fn normalize_timestamp(raw: Option<&str>) -> Option<String> {
    let raw = raw?.trim();
    chrono::DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|dt| dt.with_timezone(&chrono::Utc).to_rfc3339())
}

/// Render one node's fragments into a `(role, content)` pair.
///
/// Nodes carrying any model output (`RESPONSE`, `THINK`, `SEARCH`) are
/// assistant turns; `REQUEST` / `FILE` nodes are user turns. Reasoning is kept
/// as a `<think>` block, matching the Claude importer, and web-search results
/// are appended as a Sources list.
fn render_fragments(fragments: &[DeepSeekFragment]) -> (String, String) {
    let is_assistant = fragments
        .iter()
        .any(|f| matches!(f.fragment_type.as_str(), "RESPONSE" | "THINK" | "SEARCH"));
    let role = if is_assistant { "assistant" } else { "user" };

    let mut body: Vec<String> = Vec::new();
    let mut sources: Vec<String> = Vec::new();
    let mut attachments: Vec<String> = Vec::new();

    for fragment in fragments {
        let text = fragment.content.as_deref().map(str::trim).unwrap_or("");
        match fragment.fragment_type.as_str() {
            "THINK" => {
                if !text.is_empty() {
                    body.push(format!("<think>\n{text}\n</think>"));
                }
            }
            "SEARCH" => {
                for result in fragment.results.iter().flatten() {
                    let url = result.url.as_deref().unwrap_or("").trim();
                    if url.is_empty() {
                        continue;
                    }
                    let title = result.title.as_deref().unwrap_or("").trim();
                    let label = if title.is_empty() { url } else { title };
                    sources.push(format!("- [{}]({url})", label.replace(['[', ']'], "")));
                }
            }
            "FILE" => {
                for file in fragment.files.iter().flatten() {
                    let name = file.file_name.as_deref().unwrap_or("").trim();
                    attachments.push(if name.is_empty() { "file".to_string() } else { name.to_string() });
                }
            }
            // REQUEST, RESPONSE, and any future text-bearing fragment type.
            _ => {
                if !text.is_empty() {
                    body.push(text.to_string());
                }
            }
        }
    }

    if !attachments.is_empty() {
        body.insert(0, format!("*Attached: {}*", attachments.join(", ")));
    }
    if !sources.is_empty() {
        body.push(format!("**Sources:**\n{}", sources.join("\n")));
    }

    (role.to_string(), body.join("\n\n"))
}

/// Node ids on the path from the tree root down to `leaf` (inclusive).
fn path_to(mapping: &HashMap<String, DeepSeekNode>, leaf: &str) -> Vec<String> {
    let mut path = Vec::new();
    let mut visited = std::collections::HashSet::new();
    let mut current = Some(leaf.to_string());
    while let Some(id) = current {
        if !visited.insert(id.clone()) {
            break; // cycle guard
        }
        match mapping.get(&id) {
            Some(node) => {
                path.push(id);
                current = node.parent.clone();
            }
            None => break,
        }
    }
    path.reverse();
    path
}

/// Build the messages for one root-to-leaf path. Message ids are the source
/// node ids so paths can be compared to find where they diverge.
fn messages_for_path(
    mapping: &HashMap<String, DeepSeekNode>,
    path: &[String],
    fallback_ts: &str,
) -> Vec<ChatFileMessage> {
    let mut messages: Vec<ChatFileMessage> = Vec::new();
    let mut last_ts = fallback_ts.to_string();

    for node_id in path {
        let Some(msg) = mapping.get(node_id).and_then(|n| n.message.as_ref()) else {
            continue;
        };
        let (role, content) = render_fragments(&msg.fragments);
        if content.is_empty() {
            continue;
        }
        let timestamp = normalize_timestamp(msg.inserted_at.as_deref()).unwrap_or_else(|| last_ts.clone());
        last_ts = timestamp.clone();
        let model = if role == "assistant" { msg.model.clone() } else { None };

        // Consecutive same-role nodes (e.g. a FILE node then its REQUEST) fold
        // into one turn so the transcript alternates cleanly.
        if let Some(prev) = messages.last_mut() {
            if prev.role == role {
                prev.content = format!("{}\n\n{}", prev.content, content);
                if prev.model.is_none() {
                    prev.model = model;
                }
                continue;
            }
        }

        messages.push(ChatFileMessage {
            id: node_id.clone(),
            role,
            content,
            model,
            tokens_used: None,
            duration_ms: None,
            timestamp,
        });
    }
    messages
}

fn chat_title(raw: Option<&str>, messages: &[ChatFileMessage]) -> String {
    let raw = raw.unwrap_or("").trim();
    if !raw.is_empty() {
        return raw.to_string();
    }
    let first_prompt = messages
        .iter()
        .find(|m| m.role == "user")
        .map(|m| m.content.replace('\n', " "))
        .unwrap_or_default();
    if first_prompt.chars().count() > 120 {
        let truncated: String = first_prompt.chars().take(117).collect();
        format!("{truncated}...")
    } else if !first_prompt.is_empty() {
        first_prompt
    } else {
        "Untitled Chat".to_string()
    }
}

fn chat_data(title: String, messages: Vec<ChatFileMessage>) -> ChatFileData {
    let created_at = messages.first().map(|m| m.timestamp.clone()).unwrap_or_default();
    let updated_at = messages.last().map(|m| m.timestamp.clone()).unwrap_or_else(|| created_at.clone());
    let model = messages
        .iter()
        .rev()
        .find_map(|m| m.model.clone())
        .unwrap_or_else(|| "deepseek".to_string());
    ChatFileData {
        id: uuid::Uuid::new_v4().to_string(),
        title,
        model,
        system_prompt: String::new(),
        created_at,
        updated_at,
        messages,
    }
}

/// Parse one DeepSeek conversation into a primary chat plus its branches.
pub fn parse_deepseek_conversation(
    conv: &DeepSeekConversation,
) -> Result<ParsedDeepSeekConversation, String> {
    let mapping = &conv.mapping;
    if mapping.is_empty() {
        return Err("Conversation has no messages".to_string());
    }

    let fallback_ts = normalize_timestamp(conv.inserted_at.as_deref())
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

    // Leaves are nodes with no children that actually exist in the mapping.
    let mut leaves: Vec<&DeepSeekNode> = mapping
        .values()
        .filter(|n| n.children.iter().all(|c| !mapping.contains_key(c)))
        .collect();
    // Deterministic order, most recently active path first.
    leaves.sort_by(|a, b| {
        let ts = |n: &DeepSeekNode| n.message.as_ref().and_then(|m| normalize_timestamp(m.inserted_at.as_deref()));
        ts(b).cmp(&ts(a)).then_with(|| a.id.cmp(&b.id))
    });

    let mut paths: Vec<(String, Vec<ChatFileMessage>)> = leaves
        .iter()
        .map(|leaf| {
            let path = path_to(mapping, &leaf.id);
            (leaf.id.clone(), messages_for_path(mapping, &path, &fallback_ts))
        })
        .filter(|(_, msgs)| !msgs.is_empty())
        .collect();

    if paths.is_empty() {
        return Err("No importable messages found".to_string());
    }

    let (_, primary_messages) = paths.remove(0);
    let title = chat_title(conv.title.as_deref(), &primary_messages);

    let mut branches = Vec::new();
    for (leaf_id, messages) in paths {
        let diverge_index = primary_messages
            .iter()
            .zip(messages.iter())
            .take_while(|(a, b)| a.id == b.id)
            .count();
        // A path identical to (or a prefix of) the primary adds nothing.
        if diverge_index >= messages.len() {
            continue;
        }
        let diverge_index = diverge_index.min(primary_messages.len().saturating_sub(1));
        let n = branches.len() + 1;
        let branch_title = if n == 1 {
            format!("{title} (branch)")
        } else {
            format!("{title} (branch {n})")
        };
        branches.push(DeepSeekBranch {
            source_key: format!("{}#{}", conv.id, leaf_id),
            data: chat_data(branch_title, messages),
            diverge_index,
        });
    }

    Ok(ParsedDeepSeekConversation {
        primary: chat_data(title, primary_messages),
        branches,
    })
}

/// Result of importing a batch of DeepSeek conversations.
#[derive(Debug, Clone, Default)]
pub struct DeepSeekImportSummary {
    /// Primary chats created, one per imported conversation.
    pub session_ids: Vec<String>,
    /// Branch chats created alongside those primaries.
    pub branch_session_ids: Vec<String>,
    /// Conversations skipped because a previous import already brought them in.
    pub skipped: usize,
    /// Per-conversation failures, as `"<title>: <error>"`.
    pub errors: Vec<String>,
}

/// Import DeepSeek conversations into `workspace_id`.
///
/// Each conversation lands atomically: its primary chat, every branch chat,
/// and the `import_source_links` rows that let a re-import of the same export
/// skip it. `selected`, when given, limits the import to those conversation ids.
pub fn import_deepseek_conversations(
    conn: &Connection,
    conversations: &[DeepSeekConversation],
    workspace_id: &str,
    selected: Option<&HashSet<String>>,
) -> Result<DeepSeekImportSummary, String> {
    let already_linked = import_links::load_links(conn, SOURCE_DEEPSEEK)?;
    let mut summary = DeepSeekImportSummary::default();

    for conv in conversations {
        if selected.is_some_and(|ids| !ids.contains(&conv.id)) {
            continue;
        }
        if already_linked.contains_key(&conv.id) {
            summary.skipped += 1;
            continue;
        }
        let label = conv.title.clone().filter(|t| !t.trim().is_empty()).unwrap_or_else(|| "Untitled".to_string());
        let parsed = match parse_deepseek_conversation(conv) {
            Ok(parsed) => parsed,
            Err(e) => {
                summary.errors.push(format!("{label}: {e}"));
                continue;
            }
        };

        let result = (|| -> Result<(String, Vec<String>), String> {
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            let now = chrono::Utc::now().to_rfc3339();
            let (primary_id, primary_message_ids) =
                import_chat_data_linked(&tx, &parsed.primary, workspace_id, "", None, None)?;
            import_links::upsert_link(&tx, SOURCE_DEEPSEEK, &conv.id, &primary_id, &now)?;

            let mut branch_ids = Vec::with_capacity(parsed.branches.len());
            for branch in &parsed.branches {
                let branch_message_id = primary_message_ids
                    .get(branch.diverge_index)
                    .filter(|id| !id.is_empty())
                    .map(String::as_str);
                let (branch_id, _) = import_chat_data_linked(
                    &tx,
                    &branch.data,
                    workspace_id,
                    "",
                    Some(&primary_id),
                    branch_message_id,
                )?;
                import_links::upsert_link(&tx, SOURCE_DEEPSEEK, &branch.source_key, &branch_id, &now)?;
                branch_ids.push(branch_id);
            }
            tx.commit().map_err(|e| e.to_string())?;
            Ok((primary_id, branch_ids))
        })();

        match result {
            Ok((primary_id, branch_ids)) => {
                summary.session_ids.push(primary_id);
                summary.branch_session_ids.extend(branch_ids);
            }
            Err(e) => summary.errors.push(format!("{label}: {e}")),
        }
    }

    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conv(json: &str) -> DeepSeekConversation {
        serde_json::from_str(json).unwrap()
    }

    const LINEAR: &str = r#"{
        "id": "c1", "title": "Linear", "inserted_at": "2025-10-17T19:13:56.455000+08:00",
        "updated_at": "2025-10-17T19:14:36.376000+08:00",
        "mapping": {
            "root": {"id": "root", "parent": null, "children": ["1"], "message": null},
            "1": {"id": "1", "parent": "root", "children": ["2"], "message": {
                "model": "deepseek-chat", "inserted_at": "2025-10-17T19:14:01.108000+08:00",
                "fragments": [{"type": "REQUEST", "content": "hello"}]}},
            "2": {"id": "2", "parent": "1", "children": [], "message": {
                "model": "deepseek-reasoner", "inserted_at": "2025-10-17T19:14:01.118000+08:00",
                "fragments": [
                    {"type": "THINK", "content": "user greets me"},
                    {"type": "SEARCH", "results": [{"url": "https://example.com", "title": "Example"}]},
                    {"type": "RESPONSE", "content": "hi there"}
                ]}}
        }
    }"#;

    #[test]
    fn parses_linear_conversation_with_thinking_and_sources() {
        let parsed = parse_deepseek_conversation(&conv(LINEAR)).unwrap();
        assert!(parsed.branches.is_empty());
        let chat = parsed.primary;
        assert_eq!(chat.title, "Linear");
        assert_eq!(chat.model, "deepseek-reasoner");
        assert_eq!(chat.messages.len(), 2);
        assert_eq!(chat.messages[0].role, "user");
        assert_eq!(chat.messages[0].content, "hello");
        assert_eq!(chat.messages[0].model, None);
        assert_eq!(chat.messages[1].role, "assistant");
        assert_eq!(
            chat.messages[1].content,
            "<think>\nuser greets me\n</think>\n\nhi there\n\n**Sources:**\n- [Example](https://example.com)"
        );
        // Offset timestamps are normalized to UTC.
        assert_eq!(chat.created_at, "2025-10-17T11:14:01.108+00:00");
    }

    const BRANCHED: &str = r#"{
        "id": "c2", "title": "Forked",
        "mapping": {
            "root": {"id": "root", "parent": null, "children": ["1"], "message": null},
            "1": {"id": "1", "parent": "root", "children": ["2"], "message": {
                "inserted_at": "2025-01-01T00:00:00Z", "fragments": [{"type": "REQUEST", "content": "q1"}]}},
            "2": {"id": "2", "parent": "1", "children": ["3", "5"], "message": {
                "model": "deepseek-chat", "inserted_at": "2025-01-01T00:00:01Z",
                "fragments": [{"type": "RESPONSE", "content": "a1"}]}},
            "3": {"id": "3", "parent": "2", "children": ["4"], "message": {
                "inserted_at": "2025-01-01T00:00:02Z", "fragments": [{"type": "REQUEST", "content": "old q2"}]}},
            "4": {"id": "4", "parent": "3", "children": [], "message": {
                "model": "deepseek-chat", "inserted_at": "2025-01-01T00:00:03Z",
                "fragments": [{"type": "RESPONSE", "content": "old a2"}]}},
            "5": {"id": "5", "parent": "2", "children": ["6"], "message": {
                "inserted_at": "2025-01-02T00:00:00Z", "fragments": [
                    {"type": "FILE", "files": [{"file_name": "image.png"}]},
                    {"type": "REQUEST", "content": "new q2"}]}},
            "6": {"id": "6", "parent": "5", "children": [], "message": {
                "model": "deepseek-chat", "inserted_at": "2025-01-02T00:00:01Z",
                "fragments": [{"type": "RESPONSE", "content": "new a2"}]}}
        }
    }"#;

    #[test]
    fn latest_path_is_primary_and_older_path_is_a_branch() {
        let parsed = parse_deepseek_conversation(&conv(BRANCHED)).unwrap();
        let primary: Vec<&str> = parsed.primary.messages.iter().map(|m| m.content.as_str()).collect();
        assert_eq!(primary, vec!["q1", "a1", "*Attached: image.png*\n\nnew q2", "new a2"]);

        assert_eq!(parsed.branches.len(), 1);
        let branch = &parsed.branches[0];
        assert_eq!(branch.source_key, "c2#4");
        assert_eq!(branch.data.title, "Forked (branch)");
        assert_eq!(branch.diverge_index, 2);
        let contents: Vec<&str> = branch.data.messages.iter().map(|m| m.content.as_str()).collect();
        assert_eq!(contents, vec!["q1", "a1", "old q2", "old a2"]);
    }

    #[test]
    fn fork_at_root_diverges_at_first_message() {
        let json = r#"{
            "id": "c3", "title": "",
            "mapping": {
                "root": {"id": "root", "parent": null, "children": ["1", "2"], "message": null},
                "1": {"id": "1", "parent": "root", "children": [], "message": {
                    "inserted_at": "2025-01-01T00:00:00Z", "fragments": [{"type": "REQUEST", "content": "first try"}]}},
                "2": {"id": "2", "parent": "root", "children": [], "message": {
                    "inserted_at": "2025-01-02T00:00:00Z", "fragments": [{"type": "REQUEST", "content": "second try"}]}}
            }
        }"#;
        let parsed = parse_deepseek_conversation(&conv(json)).unwrap();
        assert_eq!(parsed.primary.title, "second try");
        assert_eq!(parsed.branches.len(), 1);
        assert_eq!(parsed.branches[0].diverge_index, 0);
    }

    #[test]
    fn rejects_chatgpt_shaped_export() {
        let json = r#"[{"id": "x", "mapping": {"a": {"id": "a", "parent": null, "children": [],
            "message": {"id": "m", "author": {"role": "user"}, "content": {"parts": ["hi"]}}}}}]"#;
        assert!(serde_json::from_str::<Vec<DeepSeekConversation>>(json).is_err());
    }

    #[test]
    fn import_links_branches_and_skips_reimport() {
        let pool = crate::db::test_utils::tests::setup_test_db();
        let conn = pool.get().unwrap();
        let workspace = crate::services::workspace_service::create(
            &conn,
            crate::models::workspace::CreateWorkspaceRequest {
                name: "DeepSeek".to_string(),
                description: None,
            },
        )
        .unwrap();
        let conversations = vec![conv(BRANCHED), conv(LINEAR)];

        let summary = import_deepseek_conversations(&conn, &conversations, &workspace.id, None).unwrap();
        assert!(summary.errors.is_empty(), "{:?}", summary.errors);
        assert_eq!(summary.session_ids.len(), 2);
        assert_eq!(summary.branch_session_ids.len(), 1);

        let primary_id = &summary.session_ids[0];
        let (parent, branch_msg): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT parent_session_id, branch_message_id FROM chat_sessions WHERE id = ?1",
                [&summary.branch_session_ids[0]],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(parent.as_deref(), Some(primary_id.as_str()));
        // branch_message_id names the primary's first divergent message ("new q2").
        let diverged: String = conn
            .query_row(
                "SELECT content FROM messages WHERE id = ?1 AND session_id = ?2",
                [branch_msg.unwrap(), primary_id.clone()],
                |r| r.get(0),
            )
            .unwrap();
        assert!(diverged.ends_with("new q2"));

        let branch_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE session_id = ?1",
                [&summary.branch_session_ids[0]],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(branch_count, 4);

        let again = import_deepseek_conversations(&conn, &conversations, &workspace.id, None).unwrap();
        assert!(again.session_ids.is_empty());
        assert_eq!(again.skipped, 2);
    }

    /// Parses a real export when `AETHERIUM_DEEPSEEK_SAMPLE` points at its folder.
    #[test]
    fn parses_sample_export_when_configured() {
        let Ok(folder) = std::env::var("AETHERIUM_DEEPSEEK_SAMPLE") else {
            return;
        };
        let path = discover_deepseek_file(Path::new(&folder)).expect("sample folder has conversations.json");
        let conversations = load_deepseek_conversations(&path).expect("sample parses");
        assert!(!conversations.is_empty());
        let mut failures = Vec::new();
        for conv in &conversations {
            if let Err(e) = parse_deepseek_conversation(conv) {
                failures.push(format!("{}: {e}", conv.id));
            }
        }
        assert!(failures.is_empty(), "unparseable conversations: {failures:?}");

        let pool = crate::db::test_utils::tests::setup_test_db();
        let conn = pool.get().unwrap();
        let workspace = crate::services::workspace_service::create(
            &conn,
            crate::models::workspace::CreateWorkspaceRequest {
                name: "DeepSeek sample".to_string(),
                description: None,
            },
        )
        .unwrap();
        let summary = import_deepseek_conversations(&conn, &conversations, &workspace.id, None).unwrap();
        assert!(summary.errors.is_empty(), "import errors: {:?}", summary.errors);
        assert_eq!(summary.session_ids.len(), conversations.len());
        eprintln!(
            "deepseek sample: {} conversations, {} branch chats",
            summary.session_ids.len(),
            summary.branch_session_ids.len()
        );
    }
}
