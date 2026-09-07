//! Boom Scroll feed — a swipeable, cross-workspace study feed over
//! `learning_cards`.
//!
//! The mobile companion app reads an exported deck file; the desktop feed
//! reads the same cards straight from SQLite, so levelling a card or banishing
//! it here is durable and shows up in the next export rather than living in
//! browser storage.

use crate::db::DbState;
use crate::models::learning_card::LearningCard;
use crate::services::workspace_hierarchy::descendant_workspace_ids;
use serde::{Deserialize, Serialize};
use tauri::State;

/// `flashcard::CARD_COLUMNS`, qualified to the `lc` alias this module's joins
/// use. Kept in the same positional order, so `row_to_card` reads it correctly;
/// `card_columns_match_flashcard_module` asserts the two stay in step.
const CARD_COLUMNS_QUALIFIED: &str = "lc.id, lc.workspace_id, lc.front, lc.back, lc.source_type, lc.source_id, lc.topic_id, lc.ease_factor, lc.interval, lc.repetitions, lc.next_review_date, lc.last_reviewed_at, lc.created_at, lc.generated_by_model, lc.kind, lc.difficulty, lc.difficulty_preset, lc.difficulty_label, lc.suspended_at";

/// A workspace offered as a filter row in the feed, with the number of
/// feed-eligible (non-suspended) cards it holds.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeedWorkspace {
    pub id: String,
    pub name: String,
    pub card_count: i64,
    pub difficulty_preset: Option<String>,
}

/// Everything the feed needs to start: the workspaces available as filters and
/// the cards themselves. Returned in one call so the view never fans out an
/// N+1 query per workspace.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeedDeck {
    pub workspaces: Vec<FeedWorkspace>,
    pub cards: Vec<FeedCard>,
}

/// A card as the feed renders it: the stored card plus its resolved topic and
/// workspace names, which the feed shows as chips on every card.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeedCard {
    #[serde(flatten)]
    pub card: LearningCard,
    pub topic: Option<String>,
    pub workspace_name: String,
}

/// Load the feed for a set of workspaces.
///
/// Suspended cards are returned too (flagged by `suspended_at`) so the
/// "Banished" review screen can list and restore them without a second query;
/// the feed itself filters them out client-side.
#[tauri::command]
pub fn load_feed_deck(
    state: State<DbState>,
    workspace_ids: Vec<String>,
    include_descendants: Option<bool>,
) -> Result<FeedDeck, String> {
    if workspace_ids.is_empty() {
        return Ok(FeedDeck {
            workspaces: Vec::new(),
            cards: Vec::new(),
        });
    }
    let conn = state.0.get().map_err(|e| e.to_string())?;

    // Expand sub-workspaces up front, so both queries below filter on one flat
    // id list. Deduplicated because two selected roots can share a descendant.
    let mut workspace_ids = workspace_ids;
    if include_descendants.unwrap_or(false) {
        let mut seen: std::collections::HashSet<String> = workspace_ids.iter().cloned().collect();
        for root in workspace_ids.clone() {
            for id in descendant_workspace_ids(&conn, &root)? {
                if seen.insert(id.clone()) {
                    workspace_ids.push(id);
                }
            }
        }
    }

    // SQLite has no array binding, so build a placeholder list. The ids come
    // from the workspace store, never from free text.
    let placeholders = std::iter::repeat_n("?", workspace_ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    let params = rusqlite::params_from_iter(workspace_ids.iter());

    let sql = format!(
        "SELECT {CARD_COLUMNS_QUALIFIED}, ft.topic, w.name
         FROM learning_cards lc
         LEFT JOIN flashcard_topics ft ON ft.id = lc.topic_id
         JOIN workspaces w ON w.id = lc.workspace_id
         WHERE lc.workspace_id IN ({placeholders})
         ORDER BY lc.created_at"
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let cards = stmt
        .query_map(params, |row| {
            Ok(FeedCard {
                card: crate::commands::flashcard::row_to_card(row)?,
                topic: row.get(19)?,
                workspace_name: row.get(20)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // One grouped query for the workspace rows, rather than a count per id.
    let ws_sql = format!(
        "SELECT w.id, w.name, w.difficulty_preset,
                COUNT(lc.id) FILTER (WHERE lc.suspended_at IS NULL)
         FROM workspaces w
         LEFT JOIN learning_cards lc ON lc.workspace_id = w.id
         WHERE w.id IN ({placeholders})
         GROUP BY w.id, w.name, w.difficulty_preset
         ORDER BY w.name"
    );
    let mut ws_stmt = conn.prepare(&ws_sql).map_err(|e| e.to_string())?;
    let workspaces = ws_stmt
        .query_map(rusqlite::params_from_iter(workspace_ids.iter()), |row| {
            Ok(FeedWorkspace {
                id: row.get(0)?,
                name: row.get(1)?,
                difficulty_preset: row.get(2)?,
                card_count: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(FeedDeck { workspaces, cards })
}

/// Banish a card from the feed, or restore it.
///
/// This is deliberately reversible — the card keeps its SM-2 schedule and its
/// content, and stays listed on the Banished screen — so it is not gated as a
/// destructive operation.
#[tauri::command]
pub fn set_card_suspended(
    state: State<DbState>,
    card_id: String,
    suspended: bool,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let value = suspended.then(|| chrono::Utc::now().to_rfc3339());
    let changed = conn
        .execute(
            "UPDATE learning_cards SET suspended_at = ?2 WHERE id = ?1",
            rusqlite::params![card_id, value],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(format!("No card with id {card_id}"));
    }
    Ok(())
}

/// Restore every suspended card in the given workspaces ("Restore all").
#[tauri::command]
pub fn restore_all_suspended(
    state: State<DbState>,
    workspace_ids: Vec<String>,
) -> Result<i64, String> {
    if workspace_ids.is_empty() {
        return Ok(0);
    }
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let placeholders = std::iter::repeat_n("?", workspace_ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    let changed = conn
        .execute(
            &format!(
                "UPDATE learning_cards SET suspended_at = NULL
                 WHERE suspended_at IS NOT NULL AND workspace_id IN ({placeholders})"
            ),
            rusqlite::params_from_iter(workspace_ids.iter()),
        )
        .map_err(|e| e.to_string())?;
    Ok(changed as i64)
}

/// Set (or clear, with `None`) a card's 1-5 difficulty level.
#[tauri::command]
pub fn set_card_difficulty(
    state: State<DbState>,
    card_id: String,
    difficulty: Option<i64>,
) -> Result<(), String> {
    if let Some(level) = difficulty {
        if !(1..=5).contains(&level) {
            return Err(format!("Difficulty must be 1-5, got {level}"));
        }
    }
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let changed = conn
        .execute(
            "UPDATE learning_cards SET difficulty = ?2 WHERE id = ?1",
            rusqlite::params![card_id, difficulty],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(format!("No card with id {card_id}"));
    }
    Ok(())
}

/// Set the domain preset that names a workspace's difficulty levels.
#[tauri::command]
pub fn set_workspace_difficulty_preset(
    state: State<DbState>,
    workspace_id: String,
    preset: Option<String>,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE workspaces SET difficulty_preset = ?2 WHERE id = ?1",
        rusqlite::params![workspace_id, preset],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::CARD_COLUMNS_QUALIFIED;
    use crate::commands::flashcard::CARD_COLUMNS;

    /// The feed maps rows with `flashcard::row_to_card`, so its qualified
    /// column list must stay identical in order and content to the shared one.
    /// Adding a column to only one of them would misalign every index in the
    /// mapper, which SQLite reports as a confusing type error at runtime
    /// rather than a compile failure.
    #[test]
    fn card_columns_match_flashcard_module() {
        let stripped: Vec<String> = CARD_COLUMNS_QUALIFIED
            .split(", ")
            .map(|c| c.trim_start_matches("lc.").to_string())
            .collect();
        let expected: Vec<String> = CARD_COLUMNS.split(", ").map(str::to_string).collect();
        assert_eq!(stripped, expected);
    }
}
