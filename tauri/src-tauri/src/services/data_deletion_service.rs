use std::path::Path;
use rusqlite::{Connection, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};

use crate::services::chat_file_store;
use crate::services::chat_move_sync;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataDeletionRequest {
    pub scope: String, // "current_workspace" | "selected_workspaces" | "all_workspaces" | "workspace"
    pub workspace_ids: Vec<String>,
    pub categories: Vec<String>, // "chats" | "notes" | "sources" | "flashcards" | "concepts" | "memories" | "queue"
    pub time_filter: Option<String>, // "all" | "7d" | "30d" | "90d" | "365d"
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DataDeletionCategoryCount {
    pub id: String,
    pub label: String,
    pub item_count: usize,
    pub total_rows: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DataDeletionPreview {
    pub workspace_count: usize,
    pub total_items: usize,
    pub total_rows: usize,
    pub categories: Vec<DataDeletionCategoryCount>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DataDeletionResult {
    pub workspace_count: usize,
    pub total_deleted_items: usize,
    pub total_deleted_rows: usize,
    pub categories: Vec<DataDeletionCategoryCount>,
}

pub struct CategoryMeta {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
}

pub const DELETION_CATEGORIES: [CategoryMeta; 7] = [
    CategoryMeta {
        id: "chats",
        label: "Chats & messages",
        description: "Chat sessions, folders, messages, citations, snapshots, summaries, and artifacts.",
    },
    CategoryMeta {
        id: "notes",
        label: "Notes & templates",
        description: "Project notes, daily notes, and custom templates.",
    },
    CategoryMeta {
        id: "sources",
        label: "Sources & documents",
        description: "Document sources, chunks, uploads, web captures, and transcriptions.",
    },
    CategoryMeta {
        id: "flashcards",
        label: "Flashcards & goals",
        description: "Learning cards, review state, learning goals, and quizzes.",
    },
    CategoryMeta {
        id: "concepts",
        label: "Concepts & knowledge map",
        description: "Concept nodes, links, mentions, statistics, change proposals, and roadmap snapshots.",
    },
    CategoryMeta {
        id: "memories",
        label: "Memories",
        description: "User memories, embeddings, and summaries.",
    },
    CategoryMeta {
        id: "queue",
        label: "Thought queue & alarms",
        description: "Thought queue items and calendar reminders.",
    },
];

pub fn get_category_label(id: &str) -> &str {
    DELETION_CATEGORIES
        .iter()
        .find(|c| c.id == id)
        .map(|c| c.label)
        .unwrap_or(id)
}

fn parse_time_filter_days(filter: Option<&str>) -> Option<u32> {
    match filter {
        Some("7d") => Some(7),
        Some("30d") => Some(30),
        Some("90d") => Some(90),
        Some("365d") => Some(365),
        _ => None,
    }
}

fn table_exists(conn: &Connection, table_name: &str) -> Result<bool, String> {
    let exists = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
            [table_name],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(exists != 0)
}

pub fn resolve_workspaces(conn: &Connection, req: &DataDeletionRequest) -> Result<Vec<String>, String> {
    match req.scope.as_str() {
        "all_workspaces" => {
            let mut stmt = conn
                .prepare("SELECT id FROM workspaces WHERE is_hidden = 0 ORDER BY created_at")
                .map_err(|e| e.to_string())?;
            let ids = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            Ok(ids)
        }
        "selected_workspaces" | "current_workspace" | "workspace" => {
            if req.workspace_ids.is_empty() {
                return Err("No workspaces specified for deletion.".to_string());
            }
            // Verify workspaces exist
            let mut validated = Vec::new();
            for ws_id in &req.workspace_ids {
                let exists: bool = conn
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = ?1)",
                        [ws_id],
                        |row| row.get::<_, i64>(0).map(|c| c != 0),
                    )
                    .unwrap_or(false);
                if exists {
                    validated.push(ws_id.clone());
                }
            }
            if validated.is_empty() {
                return Err("Specified workspaces do not exist.".to_string());
            }
            Ok(validated)
        }
        unknown => Err(format!("Unknown deletion scope: {unknown}")),
    }
}

fn build_in_clause(ids: &[String]) -> String {
    ids.iter()
        .map(|id| format!("'{}'", id.replace('\'', "''")))
        .collect::<Vec<_>>()
        .join(",")
}

pub fn preview_deletion(
    conn: &Connection,
    req: &DataDeletionRequest,
) -> Result<DataDeletionPreview, String> {
    let workspaces = resolve_workspaces(conn, req)?;
    if workspaces.is_empty() {
        return Ok(DataDeletionPreview {
            workspace_count: 0,
            total_items: 0,
            total_rows: 0,
            categories: Vec::new(),
        });
    }

    let ws_clause = build_in_clause(&workspaces);
    let cutoff_days = parse_time_filter_days(req.time_filter.as_deref());

    let mut category_counts = Vec::new();
    let mut total_items = 0;
    let mut total_rows = 0;

    for cat_id in &req.categories {
        let (items, rows) = count_category(conn, cat_id, &ws_clause, cutoff_days)?;
        total_items += items;
        total_rows += rows;
        category_counts.push(DataDeletionCategoryCount {
            id: cat_id.clone(),
            label: get_category_label(cat_id).to_string(),
            item_count: items,
            total_rows: rows,
        });
    }

    Ok(DataDeletionPreview {
        workspace_count: workspaces.len(),
        total_items,
        total_rows,
        categories: category_counts,
    })
}

fn count_category(
    conn: &Connection,
    cat_id: &str,
    ws_clause: &str,
    cutoff_days: Option<u32>,
) -> Result<(usize, usize), String> {
    let time_cond = match cutoff_days {
        Some(d) => format!(" AND updated_at <= datetime('now', '-{d} days')"),
        None => String::new(),
    };
    let created_time_cond = match cutoff_days {
        Some(d) => format!(" AND created_at <= datetime('now', '-{d} days')"),
        None => String::new(),
    };

    match cat_id {
        "chats" => {
            let session_count: usize = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM chat_sessions WHERE workspace_id IN ({ws_clause}){time_cond}"),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            let msg_count: usize = conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) FROM messages WHERE session_id IN (
                            SELECT id FROM chat_sessions WHERE workspace_id IN ({ws_clause}){time_cond}
                        )"
                    ),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            let cit_count: usize = conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) FROM citations WHERE message_id IN (
                            SELECT id FROM messages WHERE session_id IN (
                                SELECT id FROM chat_sessions WHERE workspace_id IN ({ws_clause}){time_cond}
                            )
                        )"
                    ),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            let artifact_count: usize = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM artifacts WHERE workspace_id IN ({ws_clause}){time_cond}"),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            let folder_count: usize = if cutoff_days.is_none() {
                conn.query_row(
                    &format!("SELECT COUNT(*) FROM folders WHERE workspace_id IN ({ws_clause})"),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0)
            } else {
                0
            };

            let rows = session_count + msg_count + cit_count + artifact_count + folder_count;
            Ok((session_count, rows))
        }
        "notes" => {
            let project_notes: usize = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM project_notes WHERE workspace_id IN ({ws_clause}){time_cond}"),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            let daily_time_cond = match cutoff_days {
                Some(d) => format!(" AND (date <= date('now', '-{d} days') OR updated_at <= datetime('now', '-{d} days'))"),
                None => String::new(),
            };
            let daily_notes: usize = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM daily_notes WHERE workspace_id IN ({ws_clause}){daily_time_cond}"),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            let templates: usize = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM note_templates WHERE workspace_id IN ({ws_clause}) AND is_built_in = 0{time_cond}"),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            let total = project_notes + daily_notes + templates;
            Ok((total, total))
        }
        "sources" => {
            let sources_count: usize = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM sources WHERE workspace_id IN ({ws_clause}){time_cond}"),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            let source_chunks: usize = conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) FROM source_chunks WHERE source_id IN (
                            SELECT id FROM sources WHERE workspace_id IN ({ws_clause}){time_cond}
                        )"
                    ),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            let transcriptions: usize = conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) FROM audio_transcriptions WHERE source_id IN (
                            SELECT id FROM sources WHERE workspace_id IN ({ws_clause}){time_cond}
                        )"
                    ),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            let uploads: usize = if table_exists(conn, "uploaded_documents")? {
                conn.query_row(
                    &format!("SELECT COUNT(*) FROM uploaded_documents WHERE workspace_id IN ({ws_clause}){created_time_cond}"),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0)
            } else {
                0
            };

            let web_captures: usize = if table_exists(conn, "web_captures")? {
                conn.query_row(
                    &format!("SELECT COUNT(*) FROM web_captures WHERE workspace_id IN ({ws_clause}){time_cond}"),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0)
            } else {
                0
            };

            let items = sources_count + uploads + web_captures;
            let rows = items + source_chunks + transcriptions;
            Ok((items, rows))
        }
        "flashcards" => {
            let cards: usize = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM learning_cards WHERE workspace_id IN ({ws_clause}){time_cond}"),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            let goals: usize = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM learning_goals WHERE workspace_id IN ({ws_clause}){time_cond}"),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            let topics: usize = if cutoff_days.is_none() && table_exists(conn, "flashcard_topics")? {
                conn.query_row(
                    &format!("SELECT COUNT(*) FROM flashcard_topics WHERE workspace_id IN ({ws_clause})"),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0)
            } else {
                0
            };

            let quizzes: usize = if table_exists(conn, "quizzes")? {
                conn.query_row(
                    &format!("SELECT COUNT(*) FROM quizzes WHERE workspace_id IN ({ws_clause}){created_time_cond}"),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0)
            } else {
                0
            };

            let quiz_questions: usize = if table_exists(conn, "quiz_questions")? {
                conn.query_row(
                    &format!(
                        "SELECT COUNT(*) FROM quiz_questions WHERE quiz_id IN (
                            SELECT id FROM quizzes WHERE workspace_id IN ({ws_clause}){created_time_cond}
                        )"
                    ),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0)
            } else {
                0
            };

            let items = cards + goals + quizzes;
            let rows = items + topics + quiz_questions;
            Ok((items, rows))
        }
        "concepts" => {
            let nodes: usize = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM concept_nodes WHERE workspace_id IN ({ws_clause}){time_cond}"),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            let links: usize = conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) FROM concept_links WHERE source_id IN (
                            SELECT id FROM concept_nodes WHERE workspace_id IN ({ws_clause}){time_cond}
                        ) OR target_id IN (
                            SELECT id FROM concept_nodes WHERE workspace_id IN ({ws_clause}){time_cond}
                        )"
                    ),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            let mentions: usize = conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) FROM concept_mentions WHERE concept_id IN (
                            SELECT id FROM concept_nodes WHERE workspace_id IN ({ws_clause}){time_cond}
                        )"
                    ),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            let roadmaps: usize = if table_exists(conn, "roadmap_snapshots")? {
                conn.query_row(
                    &format!("SELECT COUNT(*) FROM roadmap_snapshots WHERE workspace_id IN ({ws_clause}){created_time_cond}"),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0)
            } else {
                0
            };

            let stats: usize = if table_exists(conn, "graph_statistics")? {
                conn.query_row(
                    &format!("SELECT COUNT(*) FROM graph_statistics WHERE workspace_id IN ({ws_clause})"),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0)
            } else {
                0
            };

            let proposals: usize = if table_exists(conn, "concept_change_proposals")? {
                conn.query_row(
                    &format!("SELECT COUNT(*) FROM concept_change_proposals WHERE workspace_id IN ({ws_clause})"),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0)
            } else {
                0
            };

            let items = nodes + roadmaps;
            let rows = items + links + mentions + stats + proposals;
            Ok((items, rows))
        }
        "memories" => {
            let memories: usize = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM memories WHERE workspace_id IN ({ws_clause}){time_cond}"),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            let embeddings: usize = if table_exists(conn, "memory_embeddings")? {
                conn.query_row(
                    &format!(
                        "SELECT COUNT(*) FROM memory_embeddings WHERE memory_id IN (
                            SELECT id FROM memories WHERE workspace_id IN ({ws_clause}){time_cond}
                        )"
                    ),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0)
            } else {
                0
            };

            let summaries: usize = if table_exists(conn, "memory_summaries")? {
                conn.query_row(
                    &format!("SELECT COUNT(*) FROM memory_summaries WHERE workspace_id IN ({ws_clause})"),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0)
            } else {
                0
            };

            let items = memories;
            let rows = memories + embeddings + summaries;
            Ok((items, rows))
        }
        "queue" => {
            let queue: usize = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM thought_queue WHERE workspace_id IN ({ws_clause}){time_cond}"),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            let alarms: usize = if table_exists(conn, "calendar_alarms")? {
                conn.query_row(
                    &format!("SELECT COUNT(*) FROM calendar_alarms WHERE workspace_id IN ({ws_clause}){created_time_cond}"),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0)
            } else {
                0
            };

            let total = queue + alarms;
            Ok((total, total))
        }
        _ => Ok((0, 0)),
    }
}

pub fn execute_deletion(
    conn: &mut Connection,
    chats_dir: &Path,
    req: &DataDeletionRequest,
) -> Result<DataDeletionResult, String> {
    let workspaces = resolve_workspaces(conn, req)?;
    if workspaces.is_empty() {
        return Ok(DataDeletionResult {
            workspace_count: 0,
            total_deleted_items: 0,
            total_deleted_rows: 0,
            categories: Vec::new(),
        });
    }

    let ws_clause = build_in_clause(&workspaces);
    let cutoff_days = parse_time_filter_days(req.time_filter.as_deref());

    let _relocation = if req.categories.iter().any(|c| c == "chats") {
        Some(chat_move_sync::lock_relocations()?)
    } else {
        None
    };

    // Preflight counts
    let mut category_counts = Vec::new();
    let mut total_deleted_items = 0;
    let mut total_deleted_rows = 0;
    for cat_id in &req.categories {
        let (items, rows) = count_category(conn, cat_id, &ws_clause, cutoff_days)?;
        total_deleted_items += items;
        total_deleted_rows += rows;
        category_counts.push(DataDeletionCategoryCount {
            id: cat_id.clone(),
            label: get_category_label(cat_id).to_string(),
            item_count: items,
            total_rows: rows,
        });
    }

    let time_cond = match cutoff_days {
        Some(d) => format!(" AND updated_at <= datetime('now', '-{d} days')"),
        None => String::new(),
    };
    let created_time_cond = match cutoff_days {
        Some(d) => format!(" AND created_at <= datetime('now', '-{d} days')"),
        None => String::new(),
    };

    // Session IDs for file deletion
    let chat_session_ids: Vec<String> = if req.categories.iter().any(|c| c == "chats") {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT id FROM chat_sessions WHERE workspace_id IN ({ws_clause}){time_cond}"
            ))
            .map_err(|e| e.to_string())?;
        let ids = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        ids
    } else {
        Vec::new()
    };

    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;

    for cat_id in &req.categories {
        match cat_id.as_str() {
            "chats" => {
                if !chat_session_ids.is_empty() {
                    let variants = chat_file_store::capture_session_file_variants(
                        &tx,
                        chats_dir,
                        &chat_session_ids,
                    );
                    for id in &chat_session_ids {
                        if let Some(paths) = variants.get(id) {
                            let _ = chat_move_sync::enqueue_deletion(
                                &tx,
                                &std::collections::HashMap::from([(id.clone(), paths.clone())]),
                            );
                        }
                    }

                    let ids_clause = build_in_clause(&chat_session_ids);
                    tx.execute(
                        &format!("DELETE FROM chat_sessions WHERE id IN ({ids_clause})"),
                        [],
                    )
                    .map_err(|e| e.to_string())?;
                }

                tx.execute(
                    &format!("DELETE FROM artifacts WHERE workspace_id IN ({ws_clause}){time_cond}"),
                    [],
                )
                .map_err(|e| e.to_string())?;

                // If all sessions deleted or no time filter, clean up empty folders
                if cutoff_days.is_none() {
                    tx.execute(
                        &format!("DELETE FROM folders WHERE workspace_id IN ({ws_clause})"),
                        [],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
            "notes" => {
                tx.execute(
                    &format!("DELETE FROM project_notes WHERE workspace_id IN ({ws_clause}){time_cond}"),
                    [],
                )
                .map_err(|e| e.to_string())?;

                let daily_time_cond = match cutoff_days {
                    Some(d) => format!(" AND (date <= date('now', '-{d} days') OR updated_at <= datetime('now', '-{d} days'))"),
                    None => String::new(),
                };
                tx.execute(
                    &format!("DELETE FROM daily_notes WHERE workspace_id IN ({ws_clause}){daily_time_cond}"),
                    [],
                )
                .map_err(|e| e.to_string())?;

                tx.execute(
                    &format!("DELETE FROM note_templates WHERE workspace_id IN ({ws_clause}) AND is_built_in = 0{time_cond}"),
                    [],
                )
                .map_err(|e| e.to_string())?;
            }
            "sources" => {
                tx.execute(
                    &format!("DELETE FROM sources WHERE workspace_id IN ({ws_clause}){time_cond}"),
                    [],
                )
                .map_err(|e| e.to_string())?;

                if table_exists(&tx, "uploaded_documents")? {
                    tx.execute(
                        &format!("DELETE FROM uploaded_documents WHERE workspace_id IN ({ws_clause}){created_time_cond}"),
                        [],
                    )
                    .map_err(|e| e.to_string())?;
                }

                if table_exists(&tx, "web_captures")? {
                    tx.execute(
                        &format!("DELETE FROM web_captures WHERE workspace_id IN ({ws_clause}){time_cond}"),
                        [],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
            "flashcards" => {
                tx.execute(
                    &format!("DELETE FROM learning_cards WHERE workspace_id IN ({ws_clause}){time_cond}"),
                    [],
                )
                .map_err(|e| e.to_string())?;

                tx.execute(
                    &format!("DELETE FROM learning_goals WHERE workspace_id IN ({ws_clause}){time_cond}"),
                    [],
                )
                .map_err(|e| e.to_string())?;

                if cutoff_days.is_none() && table_exists(&tx, "flashcard_topics")? {
                    tx.execute(
                        &format!("DELETE FROM flashcard_topics WHERE workspace_id IN ({ws_clause})"),
                        [],
                    )
                    .map_err(|e| e.to_string())?;
                }

                if table_exists(&tx, "quizzes")? {
                    tx.execute(
                        &format!("DELETE FROM quizzes WHERE workspace_id IN ({ws_clause}){created_time_cond}"),
                        [],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
            "concepts" => {
                tx.execute(
                    &format!("DELETE FROM concept_nodes WHERE workspace_id IN ({ws_clause}){time_cond}"),
                    [],
                )
                .map_err(|e| e.to_string())?;

                if table_exists(&tx, "roadmap_snapshots")? {
                    tx.execute(
                        &format!("DELETE FROM roadmap_snapshots WHERE workspace_id IN ({ws_clause}){created_time_cond}"),
                        [],
                    )
                    .map_err(|e| e.to_string())?;
                }

                if table_exists(&tx, "graph_statistics")? {
                    tx.execute(
                        &format!("DELETE FROM graph_statistics WHERE workspace_id IN ({ws_clause})"),
                        [],
                    )
                    .map_err(|e| e.to_string())?;
                }

                if table_exists(&tx, "concept_change_proposals")? {
                    tx.execute(
                        &format!("DELETE FROM concept_change_proposals WHERE workspace_id IN ({ws_clause})"),
                        [],
                    )
                    .map_err(|e| e.to_string())?;
                }

                if table_exists(&tx, "blocked_topics")? {
                    tx.execute(
                        &format!("DELETE FROM blocked_topics WHERE workspace_id IN ({ws_clause})"),
                        [],
                    )
                    .map_err(|e| e.to_string())?;
                }

                if table_exists(&tx, "workspace_prompt_bank")? {
                    tx.execute(
                        &format!("DELETE FROM workspace_prompt_bank WHERE workspace_id IN ({ws_clause})"),
                        [],
                    )
                    .map_err(|e| e.to_string())?;
                }

                if table_exists(&tx, "workspace_prompt_bank_jobs")? {
                    tx.execute(
                        &format!("DELETE FROM workspace_prompt_bank_jobs WHERE workspace_id IN ({ws_clause})"),
                        [],
                    )
                    .map_err(|e| e.to_string())?;
                }

                if table_exists(&tx, "analyze_jobs")? {
                    tx.execute(
                        &format!("DELETE FROM analyze_jobs WHERE workspace_id IN ({ws_clause})"),
                        [],
                    )
                    .map_err(|e| e.to_string())?;
                }

                tx.execute(
                    &format!(
                        "UPDATE workspaces SET topic_signature = '{{}}', signature_updated_at = datetime('now') WHERE id IN ({ws_clause})"
                    ),
                    [],
                )
                .map_err(|e| e.to_string())?;
            }
            "memories" => {
                tx.execute(
                    &format!("DELETE FROM memories WHERE workspace_id IN ({ws_clause}){time_cond}"),
                    [],
                )
                .map_err(|e| e.to_string())?;

                if table_exists(&tx, "memory_summaries")? {
                    tx.execute(
                        &format!("DELETE FROM memory_summaries WHERE workspace_id IN ({ws_clause})"),
                        [],
                    )
                    .map_err(|e| e.to_string())?;
                }

                if table_exists(&tx, "memory_summary_snapshots")? {
                    tx.execute(
                        &format!("DELETE FROM memory_summary_snapshots WHERE workspace_id IN ({ws_clause})"),
                        [],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
            "queue" => {
                tx.execute(
                    &format!("DELETE FROM thought_queue WHERE workspace_id IN ({ws_clause}){time_cond}"),
                    [],
                )
                .map_err(|e| e.to_string())?;

                if table_exists(&tx, "calendar_alarms")? {
                    tx.execute(
                        &format!("DELETE FROM calendar_alarms WHERE workspace_id IN ({ws_clause}){created_time_cond}"),
                        [],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
            _ => {}
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    if !chat_session_ids.is_empty() {
        let _ = chat_move_sync::sync_deletions(conn, chats_dir);
    }

    Ok(DataDeletionResult {
        workspace_count: workspaces.len(),
        total_deleted_items,
        total_deleted_rows,
        categories: category_counts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("
            CREATE TABLE workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                topic_signature TEXT DEFAULT '{}',
                signature_updated_at TEXT,
                is_hidden INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE folders (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                name TEXT NOT NULL
            );
            CREATE TABLE chat_sessions (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                title TEXT NOT NULL DEFAULT 'Chat',
                folder_id TEXT,
                updated_at TEXT DEFAULT (datetime('now')),
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL
            );
            CREATE TABLE citations (
                id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
                source_id TEXT NOT NULL,
                source_type TEXT NOT NULL,
                excerpt TEXT NOT NULL
            );
            CREATE TABLE artifacts (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now')),
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE chat_file_sync_outbox (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                previous_plain TEXT NOT NULL,
                previous_encrypted TEXT NOT NULL,
                requires_encryption INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE chat_file_delete_outbox (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                previous_plain TEXT NOT NULL,
                previous_encrypted TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE project_notes (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now')),
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE daily_notes (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                date TEXT NOT NULL,
                content TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now')),
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE note_templates (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                content TEXT NOT NULL,
                is_built_in INTEGER DEFAULT 0,
                updated_at TEXT DEFAULT (datetime('now')),
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE sources (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now')),
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE source_chunks (
                id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
                chunk_text TEXT NOT NULL
            );
            CREATE TABLE audio_transcriptions (
                id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
                transcription TEXT NOT NULL
            );
            CREATE TABLE learning_cards (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                front TEXT NOT NULL,
                back TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now')),
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE learning_goals (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now')),
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE flashcard_topics (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                name TEXT NOT NULL
            );
            CREATE TABLE concept_nodes (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now')),
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE concept_links (
                id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE,
                target_id TEXT NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE
            );
            CREATE TABLE concept_mentions (
                id TEXT PRIMARY KEY,
                concept_id TEXT NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE,
                target_id TEXT NOT NULL
            );
            CREATE TABLE memories (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                content TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now')),
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE memory_embeddings (
                memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
                embedding BLOB NOT NULL
            );
            CREATE TABLE thought_queue (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                content TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now')),
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE calendar_alarms (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            );
        ").unwrap();
        conn
    }

    fn seed_sample_data(conn: &Connection) {
        conn.execute("INSERT INTO workspaces (id, name) VALUES ('ws-1', 'Main Workspace')", []).unwrap();
        conn.execute("INSERT INTO workspaces (id, name) VALUES ('ws-2', 'Second Workspace')", []).unwrap();

        // Chats
        conn.execute("INSERT INTO chat_sessions (id, workspace_id, title) VALUES ('cs-1', 'ws-1', 'Chat 1')", []).unwrap();
        conn.execute("INSERT INTO messages (id, session_id, role, content) VALUES ('m-1', 'cs-1', 'user', 'Hello')", []).unwrap();
        conn.execute("INSERT INTO citations (id, message_id, source_id, source_type, excerpt) VALUES ('cit-1', 'm-1', 'src-1', 'source', 'sample')", []).unwrap();
        conn.execute("INSERT INTO folders (id, workspace_id, name) VALUES ('f-1', 'ws-1', 'Folder 1')", []).unwrap();
        conn.execute("INSERT INTO artifacts (id, workspace_id, title, content) VALUES ('art-1', 'ws-1', 'Snippet', 'code')", []).unwrap();

        // Notes
        conn.execute("INSERT INTO project_notes (id, workspace_id, title, content) VALUES ('pn-1', 'ws-1', 'Project Note', 'text')", []).unwrap();
        conn.execute("INSERT INTO daily_notes (id, workspace_id, date, content) VALUES ('dn-1', 'ws-1', '2026-09-01', 'daily text')", []).unwrap();
        conn.execute("INSERT INTO note_templates (id, workspace_id, name, content, is_built_in) VALUES ('nt-custom', 'ws-1', 'Custom Template', 'template', 0)", []).unwrap();
        conn.execute("INSERT INTO note_templates (id, workspace_id, name, content, is_built_in) VALUES ('nt-builtin', 'ws-1', 'Builtin Template', 'template', 1)", []).unwrap();

        // Sources
        conn.execute("INSERT INTO sources (id, workspace_id, title) VALUES ('s-1', 'ws-1', 'Source 1')", []).unwrap();
        conn.execute("INSERT INTO source_chunks (id, source_id, chunk_text) VALUES ('sc-1', 's-1', 'chunk')", []).unwrap();

        // Flashcards
        conn.execute("INSERT INTO learning_cards (id, workspace_id, front, back) VALUES ('lc-1', 'ws-1', 'Front', 'Back')", []).unwrap();
        conn.execute("INSERT INTO learning_goals (id, workspace_id, title) VALUES ('lg-1', 'ws-1', 'Goal')", []).unwrap();

        // Concepts
        conn.execute("INSERT INTO concept_nodes (id, workspace_id, name) VALUES ('cn-1', 'ws-1', 'Rust')", []).unwrap();
        conn.execute("INSERT INTO concept_nodes (id, workspace_id, name) VALUES ('cn-2', 'ws-1', 'Tauri')", []).unwrap();
        conn.execute("INSERT INTO concept_links (id, source_id, target_id) VALUES ('cl-1', 'cn-1', 'cn-2')", []).unwrap();

        // Memories
        conn.execute("INSERT INTO memories (id, workspace_id, content) VALUES ('mem-1', 'ws-1', 'Fact')", []).unwrap();
        conn.execute("INSERT INTO memory_embeddings (memory_id, embedding) VALUES ('mem-1', X'000102')", []).unwrap();

        // Queue
        conn.execute("INSERT INTO thought_queue (id, workspace_id, content) VALUES ('tq-1', 'ws-1', 'Thought')", []).unwrap();
        conn.execute("INSERT INTO calendar_alarms (id, workspace_id, title) VALUES ('ca-1', 'ws-1', 'Alarm')", []).unwrap();
    }

    #[test]
    fn test_preview_counts_correctly() {
        let conn = setup_test_db();
        seed_sample_data(&conn);

        let req = DataDeletionRequest {
            scope: "current_workspace".into(),
            workspace_ids: vec!["ws-1".into()],
            categories: vec!["chats".into(), "notes".into(), "sources".into()],
            time_filter: None,
        };

        let preview = preview_deletion(&conn, &req).unwrap();
        assert_eq!(preview.workspace_count, 1);
        assert_eq!(preview.categories.len(), 3);

        let chats = preview.categories.iter().find(|c| c.id == "chats").unwrap();
        assert_eq!(chats.item_count, 1); // 1 session
        assert_eq!(chats.total_rows, 5); // session + msg + cit + artifact + folder

        let notes = preview.categories.iter().find(|c| c.id == "notes").unwrap();
        assert_eq!(notes.item_count, 3); // 1 project + 1 daily + 1 custom template (builtin excluded!)
        assert_eq!(notes.total_rows, 3);

        let sources = preview.categories.iter().find(|c| c.id == "sources").unwrap();
        assert_eq!(sources.item_count, 1);
        assert_eq!(sources.total_rows, 2); // source + chunk
    }

    #[test]
    fn test_execute_selective_deletion() {
        let mut conn = setup_test_db();
        seed_sample_data(&conn);
        let temp = tempdir().unwrap();

        let req = DataDeletionRequest {
            scope: "workspace".into(),
            workspace_ids: vec!["ws-1".into()],
            categories: vec!["notes".into()],
            time_filter: None,
        };

        let result = execute_deletion(&mut conn, temp.path(), &req).unwrap();
        assert_eq!(result.total_deleted_items, 3);

        // Project notes, daily notes, and custom templates deleted
        let pn_count: usize = conn.query_row("SELECT COUNT(*) FROM project_notes WHERE workspace_id = 'ws-1'", [], |r| r.get(0)).unwrap();
        let dn_count: usize = conn.query_row("SELECT COUNT(*) FROM daily_notes WHERE workspace_id = 'ws-1'", [], |r| r.get(0)).unwrap();
        let custom_t_count: usize = conn.query_row("SELECT COUNT(*) FROM note_templates WHERE id = 'nt-custom'", [], |r| r.get(0)).unwrap();
        let builtin_t_count: usize = conn.query_row("SELECT COUNT(*) FROM note_templates WHERE id = 'nt-builtin'", [], |r| r.get(0)).unwrap();

        assert_eq!(pn_count, 0);
        assert_eq!(dn_count, 0);
        assert_eq!(custom_t_count, 0);
        assert_eq!(builtin_t_count, 1); // Built-in preserved!

        // Other categories untouched!
        let cs_count: usize = conn.query_row("SELECT COUNT(*) FROM chat_sessions WHERE workspace_id = 'ws-1'", [], |r| r.get(0)).unwrap();
        assert_eq!(cs_count, 1);
        let s_count: usize = conn.query_row("SELECT COUNT(*) FROM sources WHERE workspace_id = 'ws-1'", [], |r| r.get(0)).unwrap();
        assert_eq!(s_count, 1);
    }

    #[test]
    fn test_execute_chats_cascades_properly() {
        let mut conn = setup_test_db();
        seed_sample_data(&conn);
        let temp = tempdir().unwrap();

        let req = DataDeletionRequest {
            scope: "current_workspace".into(),
            workspace_ids: vec!["ws-1".into()],
            categories: vec!["chats".into()],
            time_filter: None,
        };

        let result = execute_deletion(&mut conn, temp.path(), &req).unwrap();
        assert_eq!(result.total_deleted_items, 1);

        // Sessions, messages, citations, folders, artifacts deleted
        let cs_count: usize = conn.query_row("SELECT COUNT(*) FROM chat_sessions", [], |r| r.get(0)).unwrap();
        let msg_count: usize = conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0)).unwrap();
        let cit_count: usize = conn.query_row("SELECT COUNT(*) FROM citations", [], |r| r.get(0)).unwrap();
        let art_count: usize = conn.query_row("SELECT COUNT(*) FROM artifacts", [], |r| r.get(0)).unwrap();
        let f_count: usize = conn.query_row("SELECT COUNT(*) FROM folders", [], |r| r.get(0)).unwrap();

        assert_eq!(cs_count, 0);
        assert_eq!(msg_count, 0);
        assert_eq!(cit_count, 0);
        assert_eq!(art_count, 0);
        assert_eq!(f_count, 0);

        // Memories and notes untouched
        let mem_count: usize = conn.query_row("SELECT COUNT(*) FROM memories", [], |r| r.get(0)).unwrap();
        assert_eq!(mem_count, 1);
    }

    #[test]
    fn test_time_filter_cutoff() {
        let mut conn = setup_test_db();
        seed_sample_data(&conn);
        let temp = tempdir().unwrap();

        // Mark one note as old (60 days ago) and add a fresh note
        conn.execute("UPDATE project_notes SET updated_at = datetime('now', '-60 days') WHERE id = 'pn-1'", []).unwrap();
        conn.execute("INSERT INTO project_notes (id, workspace_id, title, content, updated_at) VALUES ('pn-fresh', 'ws-1', 'Fresh', 'content', datetime('now'))", []).unwrap();

        let req = DataDeletionRequest {
            scope: "current_workspace".into(),
            workspace_ids: vec!["ws-1".into()],
            categories: vec!["notes".into()],
            time_filter: Some("30d".into()),
        };

        // Preview should see only the old note (and old daily note if updated_at is old)
        let preview = preview_deletion(&conn, &req).unwrap();
        let notes = preview.categories.iter().find(|c| c.id == "notes").unwrap();
        assert_eq!(notes.item_count, 1); // only pn-1 is older than 30 days

        execute_deletion(&mut conn, temp.path(), &req).unwrap();

        let remaining: usize = conn.query_row("SELECT COUNT(*) FROM project_notes WHERE id = 'pn-fresh'", [], |r| r.get(0)).unwrap();
        assert_eq!(remaining, 1); // Fresh note survived!

        let old_remaining: usize = conn.query_row("SELECT COUNT(*) FROM project_notes WHERE id = 'pn-1'", [], |r| r.get(0)).unwrap();
        assert_eq!(old_remaining, 0); // Old note deleted!
    }
}
