//! Convert a Claude export into an Aetherium workspace backup.
//!
//! Emits exactly the shape `commands::backup::create_backup` produces, so the
//! result restores through the existing untouched `restore_backup` path:
//!
//! ```text
//! { id, version: "2.0", created_at, workspace, data: { <table>: [rows] }, stats }
//! ```
//!
//! Projects become `folders`, conversations become `chat_sessions`, and messages
//! become `messages`. Project membership is not in the export — every chat in
//! `conversations.json` is an orphan — so it is inferred by `claude_v2_match`
//! and, for chats no project fits, proposed as new folders by
//! `claude_v2_cluster`.

use std::collections::HashMap;

use serde_json::{json, Map, Value};

use super::claude_v2_cluster::ChatCluster;
use super::claude_v2_match::MatchSuggestion;
use super::{ClaudeConversationPreview, ClaudeProjectPreview};

/// Label prefix for folders proposed by clustering rather than present in the
/// export. Makes generated groups obvious in the UI so the user can rename or
/// discard them.
const CLUSTER_LABEL_PREFIX: &str = "Suggested: ";

/// How a chat came to be in the folder it landed in — carried out so callers can
/// report the mapping rather than presenting inference as fact.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Placement {
    /// Matched to a project from the export.
    Matched,
    /// Grouped with similar chats into a proposed folder.
    Clustered,
    /// No project matched and no cluster claimed it.
    Unsorted,
}

/// Per-chat record of where a conversation went and why.
#[derive(Debug, Clone)]
pub struct PlacementRecord {
    pub conversation_uuid: String,
    pub title: String,
    pub folder_name: String,
    pub placement: Placement,
    /// Matcher reason ("title", "topics", "keywords", "semantic") when matched.
    pub reason: Option<&'static str>,
    pub score: f32,
}

/// The generated backup plus the mapping that produced it.
pub struct BackupBuild {
    pub backup: Value,
    pub placements: Vec<PlacementRecord>,
}

/// Deterministic id for a row, so re-running the conversion over the same export
/// produces the same backup rather than a fresh set of uuids each time.
///
/// Claude's own uuids are reused where they exist (chats, projects); messages
/// get one derived from their chat and index, because a Claude message uuid is
/// unique per message but the export can repeat a uuid across regenerations.
fn stable_id(kind: &str, key: &str) -> String {
    // Not cryptographic — only needs to be stable and collision-free enough for
    // primary keys within one workspace.
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in kind.as_bytes().iter().chain(b"/").chain(key.as_bytes()) {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{kind}-{h:016x}")
}

/// Claude sender names to the `messages.role` CHECK constraint
/// (`'user' | 'assistant' | 'system'`). Anything unrecognised is treated as a
/// user turn: dropping it would silently lose transcript content.
fn role_for(sender: &str) -> &'static str {
    match sender {
        "assistant" => "assistant",
        "system" => "system",
        _ => "user",
    }
}

fn folder_row(id: &str, workspace_id: &str, name: &str, description: &str, now: &str) -> Value {
    json!({
        "id": id,
        "workspace_id": workspace_id,
        "name": name,
        "folder_description": description,
        "custom_instructions": "",
        "color": "#007AFF",
        "icon": "folder",
        "created_at": now,
        "updated_at": now,
    })
}

/// Build the backup.
///
/// `suggestions` must be aligned with `conversations` (one entry per chat, as
/// every matcher entry point returns). `clusters` may be empty, in which case
/// unmatched chats land in a single "Unsorted" folder rather than being dropped.
pub fn build_backup(
    workspace_name: &str,
    conversations: &[ClaudeConversationPreview],
    projects: &[ClaudeProjectPreview],
    suggestions: &[MatchSuggestion],
    clusters: &[ChatCluster],
    now: &str,
) -> BackupBuild {
    let workspace_id = stable_id("ws", workspace_name);

    // Folder per exported project, keyed by Claude's project uuid.
    let mut folders: Vec<Value> = Vec::new();
    let mut folder_id_by_project: HashMap<&str, String> = HashMap::new();
    let mut folder_name_by_id: HashMap<String, String> = HashMap::new();
    for p in projects {
        let id = stable_id("folder", &p.uuid);
        folder_id_by_project.insert(p.uuid.as_str(), id.clone());
        folder_name_by_id.insert(id.clone(), p.name.clone());
        folders.push(folder_row(
            &id,
            &workspace_id,
            &p.name,
            &p.description,
            now,
        ));
    }

    let suggested: HashMap<&str, &MatchSuggestion> = suggestions
        .iter()
        .map(|s| (s.conversation_uuid.as_str(), s))
        .collect();

    // Folder per proposed cluster, for chats no project matched. A chat already
    // matched to a project keeps that project — clustering only ever claims
    // chats the matcher left unplaced.
    let mut cluster_folder_by_chat: HashMap<&str, String> = HashMap::new();
    for c in clusters {
        let members: Vec<&String> = c
            .conversation_uuids
            .iter()
            .filter(|uuid| {
                suggested
                    .get(uuid.as_str())
                    .and_then(|s| s.project_uuid.as_ref())
                    .is_none()
            })
            .collect();
        if members.is_empty() {
            continue;
        }
        let id = stable_id("folder", &c.id);
        let name = format!("{CLUSTER_LABEL_PREFIX}{}", c.label);
        folder_name_by_id.insert(id.clone(), name.clone());
        folders.push(folder_row(
            &id,
            &workspace_id,
            &name,
            &format!("Proposed from shared topics: {}", c.terms.join(", ")),
            now,
        ));
        for uuid in members {
            cluster_folder_by_chat.insert(uuid.as_str(), id.clone());
        }
    }

    // Catch-all, added only if something actually needs it.
    let unsorted_id = stable_id("folder", "unsorted");
    let mut used_unsorted = false;

    let mut sessions: Vec<Value> = Vec::new();
    let mut messages: Vec<Value> = Vec::new();
    let mut placements: Vec<PlacementRecord> = Vec::new();

    for conv in conversations {
        let hit = suggested.get(conv.uuid.as_str());
        let (folder_id, placement, reason, score) = match hit.and_then(|s| {
            s.project_uuid
                .as_deref()
                .and_then(|p| folder_id_by_project.get(p))
                .map(|f| (f.clone(), s))
        }) {
            Some((folder_id, s)) => (folder_id, Placement::Matched, Some(s.reason), s.score),
            None => match cluster_folder_by_chat.get(conv.uuid.as_str()) {
                Some(folder_id) => (folder_id.clone(), Placement::Clustered, None, 0.0),
                None => {
                    used_unsorted = true;
                    (unsorted_id.clone(), Placement::Unsorted, None, 0.0)
                }
            },
        };

        let session_id = stable_id("chat", &conv.uuid);
        sessions.push(json!({
            "id": session_id,
            "workspace_id": workspace_id,
            "folder_id": folder_id,
            "title": conv.name,
            "model_name": "",
            "system_prompt": "",
            "is_pinned": 0,
            "is_incognito": 0,
            "exclude_from_analytics": 0,
            "is_deleted": 0,
            "deleted_at": Value::Null,
            "last_accessed_at": Value::Null,
            "last_processed_message_count": 0,
            "is_imported": 1,
            "parent_session_id": Value::Null,
            "branch_message_id": Value::Null,
            "is_unread": 0,
            "created_at": conv.created_at,
            "updated_at": conv.updated_at,
        }));

        for (i, msg) in conv.messages.iter().enumerate() {
            messages.push(json!({
                "id": stable_id("msg", &format!("{}:{i}", conv.uuid)),
                "session_id": session_id,
                "role": role_for(&msg.role),
                "content": msg.content,
                "model_name": Value::Null,
                "tokens_used": Value::Null,
                "duration_ms": Value::Null,
                // Ordered within a session by insertion; the export gives no
                // per-message timestamp in the preview shape.
                "created_at": conv.created_at,
            }));
        }

        placements.push(PlacementRecord {
            conversation_uuid: conv.uuid.clone(),
            title: conv.name.clone(),
            folder_name: folder_name_by_id
                .get(&folder_id)
                .cloned()
                .unwrap_or_else(|| "Unsorted".to_string()),
            placement,
            reason,
            score,
        });
    }

    if used_unsorted {
        folders.push(folder_row(
            &unsorted_id,
            &workspace_id,
            "Unsorted",
            "Chats that matched no project and joined no proposed group.",
            now,
        ));
    }

    let mut data = Map::new();
    data.insert("folders".to_string(), Value::Array(folders));
    data.insert("chat_sessions".to_string(), Value::Array(sessions));
    data.insert("messages".to_string(), Value::Array(messages));

    let folder_count = data["folders"].as_array().map_or(0, |r| r.len());
    let chat_count = data["chat_sessions"].as_array().map_or(0, |r| r.len());
    let message_count = data["messages"].as_array().map_or(0, |r| r.len());

    let backup = json!({
        "id": stable_id("backup", workspace_name),
        "version": "2.0",
        "created_at": now,
        "workspace": {
            "id": workspace_id,
            "name": workspace_name,
            "description": "Imported from a Claude export.",
            "prompt_instructions": "",
            "topic_signature": "{}",
            "signature_updated_at": Value::Null,
            "is_hidden": 0,
            "created_at": now,
            "updated_at": now,
            "about_you": "",
            "survey_data": Value::Null,
        },
        "data": data,
        "stats": {
            "folder_count": folder_count,
            "chat_count": chat_count,
            "message_count": message_count,
            "note_count": 0,
            "source_count": 0,
            "artifact_count": 0,
        },
    });

    BackupBuild {
        backup,
        placements,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::{ClaudeMessagePreview, ClaudeProjectPreview};

    fn conv(uuid: &str, name: &str, turns: &[(&str, &str)]) -> ClaudeConversationPreview {
        ClaudeConversationPreview {
            uuid: uuid.to_string(),
            name: name.to_string(),
            message_count: turns.len(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            project_uuid: None,
            first_user_message: String::new(),
            summary: String::new(),
            messages: turns
                .iter()
                .map(|(role, content)| ClaudeMessagePreview {
                    role: role.to_string(),
                    content: content.to_string(),
                })
                .collect(),
        }
    }

    fn project(uuid: &str, name: &str) -> ClaudeProjectPreview {
        ClaudeProjectPreview {
            uuid: uuid.to_string(),
            name: name.to_string(),
            description: String::new(),
            has_prompt: false,
            doc_count: 0,
            conversation_count: 0,
            has_memory: false,
            prompt_template: String::new(),
        }
    }

    fn hit(uuid: &str, project: Option<&str>) -> MatchSuggestion {
        MatchSuggestion {
            conversation_uuid: uuid.to_string(),
            project_uuid: project.map(|p| p.to_string()),
            score: 0.7,
            reason: "keywords",
            alternates: Vec::new(),
        }
    }

    #[test]
    fn matched_chats_land_in_their_project_folder() {
        let convs = vec![conv("c1", "Chat", &[("human", "hi"), ("assistant", "yo")])];
        let projects = vec![project("p1", "Java")];
        let out = build_backup(
            "W",
            &convs,
            &projects,
            &[hit("c1", Some("p1"))],
            &[],
            "2026-01-01T00:00:00Z",
        );

        let folders = out.backup["data"]["folders"].as_array().unwrap();
        let java = folders.iter().find(|f| f["name"] == "Java").unwrap();
        let session = &out.backup["data"]["chat_sessions"][0];
        assert_eq!(session["folder_id"], java["id"]);
        assert_eq!(out.placements[0].placement, Placement::Matched);

        // "human" must become "user" to satisfy the messages CHECK constraint.
        let roles: Vec<&str> = out.backup["data"]["messages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["role"].as_str().unwrap())
            .collect();
        assert_eq!(roles, vec!["user", "assistant"]);
    }

    #[test]
    fn unmatched_chats_join_their_cluster_and_the_rest_go_unsorted() {
        let convs = vec![
            conv("c1", "Docker one", &[("human", "a")]),
            conv("c2", "Docker two", &[("human", "b")]),
            conv("c3", "Nothing alike", &[("human", "c")]),
        ];
        let clusters = vec![ChatCluster {
            id: "cl1".to_string(),
            label: "Docker".to_string(),
            terms: vec!["docker".to_string()],
            conversation_uuids: vec!["c1".to_string(), "c2".to_string()],
        }];
        let out = build_backup(
            "W",
            &convs,
            &[],
            &[hit("c1", None), hit("c2", None), hit("c3", None)],
            &clusters,
            "2026-01-01T00:00:00Z",
        );

        assert_eq!(out.placements[0].placement, Placement::Clustered);
        assert_eq!(out.placements[1].placement, Placement::Clustered);
        assert_eq!(out.placements[2].placement, Placement::Unsorted);
        assert!(out.placements[0].folder_name.starts_with(CLUSTER_LABEL_PREFIX));

        let names: Vec<&str> = out.backup["data"]["folders"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"Unsorted"));
    }

    /// A matched chat must keep its project even if a cluster also lists it.
    #[test]
    fn a_matched_chat_is_not_stolen_by_a_cluster() {
        let convs = vec![conv("c1", "Chat", &[("human", "a")])];
        let clusters = vec![ChatCluster {
            id: "cl1".to_string(),
            label: "Group".to_string(),
            terms: vec!["x".to_string()],
            conversation_uuids: vec!["c1".to_string()],
        }];
        let out = build_backup(
            "W",
            &convs,
            &[project("p1", "Java")],
            &[hit("c1", Some("p1"))],
            &clusters,
            "2026-01-01T00:00:00Z",
        );
        assert_eq!(out.placements[0].folder_name, "Java");
        // The cluster had no unmatched members, so it must not become a folder.
        let names: Vec<&str> = out.backup["data"]["folders"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, vec!["Java"]);
    }

    /// Convert a real Claude export into a restorable Aetherium backup, running
    /// the full pipeline: lexical match, semantic rescue, clustering, emit.
    ///
    /// Writes the backup and a placement report next to each other, and prints
    /// where they went. Triple-gated — export, output path, and (optionally) an
    /// embedding model; without the model the semantic tier sits out.
    ///
    /// ```text
    /// AETHERIUM_CLAUDE_V2_SAMPLE=/path/to/export \
    ///   AETHERIUM_BACKUP_OUT=/path/to/out.json \
    ///   AETHERIUM_EMBED_MODEL=nomic-embed-text \
    ///   cargo test --lib convert_sample_export_to_backup -- --nocapture
    /// ```
    #[test]
    fn convert_sample_export_to_backup() {
        use std::collections::HashSet;

        let Some(export_path) =
            std::env::var_os("AETHERIUM_CLAUDE_V2_SAMPLE").map(std::path::PathBuf::from)
        else {
            eprintln!("skipping convert_sample_export_to_backup: set AETHERIUM_CLAUDE_V2_SAMPLE");
            return;
        };
        let Ok(out_path) = std::env::var("AETHERIUM_BACKUP_OUT") else {
            eprintln!("skipping convert_sample_export_to_backup: set AETHERIUM_BACKUP_OUT");
            return;
        };

        use super::super::{claude_v2, claude_v2_cluster, claude_v2_match};
        let export_path = export_path.as_path();
        let (convs_by_project, _) = claude_v2::preview_v2_design_chats(export_path).unwrap();
        let name_map = claude_v2::load_v2_project_name_map(export_path);
        let (memory_uuids, memories) =
            claude_v2::parse_v2_memories(export_path, &name_map).unwrap();
        let projects =
            claude_v2::preview_v2_projects(export_path, &memory_uuids, &convs_by_project).unwrap();
        let bytes = std::fs::read(export_path.join("conversations.json")).unwrap();
        let (orphans, _) = super::super::preview_claude_conversations(&bytes).unwrap();
        let memories_by_project: HashMap<String, String> = memories
            .folder_memories
            .iter()
            .map(|m| (m.project_uuid.clone(), m.memory.clone()))
            .collect();

        // Lexical pass, then semantic rescue when an embedding model is offered.
        let mut suggestions =
            claude_v2_match::suggest_project_for_conversations(&orphans, &projects, &memories_by_project);

        let mut chat_embeddings: HashMap<String, Vec<f32>> = HashMap::new();
        if let Ok(model) = std::env::var("AETHERIUM_EMBED_MODEL") {
            let rt = tokio::runtime::Runtime::new().unwrap();
            let embed = |texts: Vec<(String, String)>| -> HashMap<String, Vec<f32>> {
                rt.block_on(async {
                    let client = crate::ollama::client::OllamaClient::new(None).unwrap();
                    let mut out = HashMap::new();
                    for (key, text) in texts {
                        if text.trim().is_empty() {
                            continue;
                        }
                        if let Ok(mut v) = client
                            .generate_embedding_with_options(
                                "claude_backup_test",
                                &model,
                                &text,
                                Some("5m"),
                            )
                            .await
                        {
                            let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
                            if n > 0.0 {
                                v.iter_mut().for_each(|x| *x /= n);
                                out.insert(key, v);
                            }
                        }
                    }
                    out
                })
            };

            let project_embeddings = embed(
                projects
                    .iter()
                    .map(|p| {
                        let memory =
                            memories_by_project.get(&p.uuid).cloned().unwrap_or_default();
                        let text = claude_v2_match::project_source_text(
                            &p.prompt_template,
                            &p.description,
                            &memory,
                            claude_v2_match::PROJECT_EMBED_CHARS,
                        );
                        (p.uuid.clone(), format!("{} {}", p.name, text))
                    })
                    .collect(),
            );
            if !project_embeddings.is_empty() {
                chat_embeddings = embed(
                    orphans
                        .iter()
                        .zip(&suggestions)
                        .filter(|(_, s)| s.project_uuid.is_none())
                        .map(|(c, _)| {
                            (c.uuid.clone(), claude_v2_match::chat_embedding_input(c))
                        })
                        .collect(),
                );
                suggestions = claude_v2_match::suggest_project_for_conversations_with_embeddings(
                    &orphans,
                    &projects,
                    &memories_by_project,
                    &HashMap::new(),
                    &chat_embeddings,
                    &project_embeddings,
                    claude_v2_match::margin_for_strictness("balanced"),
                );
            }
        }

        // Propose groups for whatever is still unplaced.
        let unmatched: HashSet<String> = suggestions
            .iter()
            .filter(|s| s.project_uuid.is_none())
            .map(|s| s.conversation_uuid.clone())
            .collect();
        let clusters = if chat_embeddings.is_empty() {
            claude_v2_cluster::cluster_unmatched(&orphans, &unmatched)
        } else {
            claude_v2_cluster::cluster_by_embedding(&orphans, &unmatched, &chat_embeddings)
        };

        let built = build_backup(
            "Claude Import",
            &orphans,
            &projects,
            &suggestions,
            &clusters,
            &chrono::Utc::now().to_rfc3339(),
        );

        std::fs::write(
            &out_path,
            serde_json::to_string_pretty(&built.backup).unwrap(),
        )
        .unwrap();

        // Placement report, so the mapping can be audited before restoring.
        let report_path = format!("{out_path}.report.txt");
        let mut report = String::new();
        let mut by_folder: HashMap<&str, Vec<&PlacementRecord>> = HashMap::new();
        for p in &built.placements {
            by_folder.entry(p.folder_name.as_str()).or_default().push(p);
        }
        let mut folder_names: Vec<&&str> = by_folder.keys().collect();
        folder_names.sort_by_key(|n| std::cmp::Reverse(by_folder[**n].len()));
        for name in folder_names {
            let rows = &by_folder[*name];
            report.push_str(&format!("\n=== {} ({} chats)\n", name, rows.len()));
            for r in rows {
                report.push_str(&format!(
                    "  [{}{}] {}\n",
                    match r.placement {
                        Placement::Matched => r.reason.unwrap_or("matched"),
                        Placement::Clustered => "cluster",
                        Placement::Unsorted => "unsorted",
                    },
                    if r.score > 0.0 {
                        format!(" {:.2}", r.score)
                    } else {
                        String::new()
                    },
                    r.title
                ));
            }
        }
        std::fs::write(&report_path, &report).unwrap();

        let matched = built
            .placements
            .iter()
            .filter(|p| p.placement == Placement::Matched)
            .count();
        let clustered = built
            .placements
            .iter()
            .filter(|p| p.placement == Placement::Clustered)
            .count();
        let unsorted = built
            .placements
            .iter()
            .filter(|p| p.placement == Placement::Unsorted)
            .count();
        eprintln!(
            "[backup] {} chats, {} messages, {} folders",
            built.backup["stats"]["chat_count"],
            built.backup["stats"]["message_count"],
            built.backup["stats"]["folder_count"],
        );
        eprintln!(
            "[backup] matched {matched}, clustered {clustered}, unsorted {unsorted}"
        );
        eprintln!("[backup] wrote {out_path}");
        eprintln!("[backup] wrote {report_path}");

        // Every chat must be accounted for, and every session must point at a
        // folder that exists — otherwise the restore violates its FK.
        assert_eq!(matched + clustered + unsorted, orphans.len());
        let folder_ids: HashSet<&str> = built.backup["data"]["folders"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["id"].as_str().unwrap())
            .collect();
        for s in built.backup["data"]["chat_sessions"].as_array().unwrap() {
            assert!(
                folder_ids.contains(s["folder_id"].as_str().unwrap()),
                "session points at a folder not in the backup"
            );
        }
    }

    /// Re-running over the same export must produce identical ids, so a repeated
    /// conversion overwrites its workspace rather than duplicating it.
    #[test]
    fn ids_are_stable_across_runs() {
        let convs = vec![conv("c1", "Chat", &[("human", "a")])];
        let projects = vec![project("p1", "Java")];
        let a = build_backup("W", &convs, &projects, &[hit("c1", Some("p1"))], &[], "t");
        let b = build_backup("W", &convs, &projects, &[hit("c1", Some("p1"))], &[], "t");
        assert_eq!(a.backup, b.backup);
    }
}
