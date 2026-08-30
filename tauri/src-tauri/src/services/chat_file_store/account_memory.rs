//! Account-level memory imported from an AI provider's data export.
//!
//! Distinct from project memory, which is scoped to one project and already
//! handled by the `folder_memories` path. Account memory describes the *user* —
//! profile, preferences, recurring topics — and belongs to no project.
//!
//! The [`ImportedMemory`] type is deliberately provider-neutral: a parser turns
//! one provider's export into a `Vec<ImportedMemory>`, and everything
//! downstream (preview, selection, upsert) is shared. Only Claude has a parser
//! today; adding another means adding a parser, not touching the import path.

use serde::Serialize;

/// Prefix that namespaces an account memory's key inside
/// `import_memory_links.source_project_uuid`.
///
/// That column is half of the table's `UNIQUE(source, source_project_uuid)`,
/// so account memories reuse it rather than needing a schema change. A real
/// project UUID can never collide: this prefix is not valid UUID syntax.
pub const ACCOUNT_KEY_PREFIX: &str = "__account__:";

/// Build the `source_project_uuid` value identifying one account memory.
pub fn account_link_key(path: &str) -> String {
    format!("{ACCOUNT_KEY_PREFIX}{path}")
}

/// How an imported memory should be classified in the `memories` table.
///
/// Mirrors the `memory_type` CHECK constraint — `fact` or `preference`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportedMemoryKind {
    Fact,
    Preference,
}

impl ImportedMemoryKind {
    /// The literal written to `memories.memory_type`.
    pub fn as_db_value(self) -> &'static str {
        match self {
            ImportedMemoryKind::Fact => "fact",
            ImportedMemoryKind::Preference => "preference",
        }
    }
}

/// One account-level memory, ready to preview or import.
///
/// `key` is the stable per-provider identity used for re-import matching —
/// for Claude, the export's own file path (`topics/fitness.md`).
#[derive(Debug, Clone, Serialize)]
pub struct ImportedMemory {
    /// Stable identity within the provider (e.g. `topics/fitness.md`).
    pub key: String,
    /// Human-readable grouping for the preview UI (e.g. `Topics`).
    pub category: String,
    /// Display name within the category (e.g. `Fitness`).
    pub label: String,
    /// The memory text itself — one fact per entry.
    pub content: String,
    pub kind: ImportedMemoryKind,
    /// Provider timestamp, when the export carries one.
    pub updated_at: Option<String>,
}

/// Split a Claude memory file's markdown body into individual facts.
///
/// Claude v3 writes YAML frontmatter followed by provenance-tagged bullets:
///
/// ```text
/// ---
/// name: fitness
/// ---
/// - [stated] Strong interest in fitness
/// ```
///
/// The frontmatter is metadata about the file rather than a fact, so it is
/// dropped; each bullet becomes one memory. A file with no recognisable
/// bullets falls back to its whole body, so an unexpected shape imports as one
/// memory rather than silently yielding nothing.
fn split_claude_memory_bullets(content: &str) -> Vec<String> {
    let body = strip_frontmatter(content);

    let bullets: Vec<String> = body
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            let rest = line.strip_prefix("- ").or_else(|| line.strip_prefix("* "))?;
            // Drop the `[stated]` provenance tag; it describes how Claude
            // learned the fact, not the fact itself.
            let rest = match (rest.find('['), rest.find(']')) {
                (Some(0), Some(close)) => rest[close + 1..].trim(),
                _ => rest.trim(),
            };
            (!rest.is_empty()).then(|| rest.to_string())
        })
        .collect();

    if bullets.is_empty() {
        let whole = body.trim();
        if whole.is_empty() {
            Vec::new()
        } else {
            vec![whole.to_string()]
        }
    } else {
        bullets
    }
}

/// Remove a leading `---` delimited YAML frontmatter block, if present.
fn strip_frontmatter(content: &str) -> &str {
    let trimmed = content.trim_start();
    let Some(rest) = trimmed.strip_prefix("---") else {
        return content;
    };
    // Find the closing delimiter on its own line.
    match rest.find("\n---") {
        Some(idx) => rest[idx + 4..].trim_start_matches('\n'),
        None => content,
    }
}

/// Turn a memory file's path into a category and label for the preview UI.
///
/// `/topics/career-development.md` becomes ("Topics", "Career development").
fn describe_path(path: &str) -> (String, String) {
    let cleaned = path.trim_start_matches('/');
    let (dir, file) = match cleaned.rsplit_once('/') {
        Some((dir, file)) => (dir, file),
        None => ("", cleaned),
    };

    let stem = file.strip_suffix(".md").unwrap_or(file);
    let label = titleize(stem);
    let category = if dir.is_empty() {
        "Profile".to_string()
    } else {
        titleize(dir)
    };
    (category, label)
}

/// `career-development` → `Career development`.
fn titleize(raw: &str) -> String {
    let spaced = raw.replace(['-', '_'], " ");
    let mut chars = spaced.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => spaced,
    }
}

/// Parse Claude's `memory_files` into provider-neutral memories.
///
/// Everything under `/preferences` is classified as a preference; the rest are
/// facts. Files that yield no content are skipped rather than importing blanks.
pub fn parse_claude_account_memories(
    files: &[(String, String, Option<String>)],
) -> Vec<ImportedMemory> {
    let mut out = Vec::new();

    for (path, content, updated_at) in files {
        let (category, label) = describe_path(path);
        let normalized = path.trim_start_matches('/');
        let kind = if normalized.starts_with("preferences") {
            ImportedMemoryKind::Preference
        } else {
            ImportedMemoryKind::Fact
        };

        for (idx, fact) in split_claude_memory_bullets(content).into_iter().enumerate() {
            out.push(ImportedMemory {
                // Index keeps each bullet individually addressable, so editing
                // one fact upstream updates that row rather than duplicating.
                key: format!("{normalized}#{idx}"),
                category: category.clone(),
                label: label.clone(),
                content: fact,
                kind,
                updated_at: updated_at.clone(),
            });
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claude_file(path: &str, content: &str) -> (String, String, Option<String>) {
        (path.to_string(), content.to_string(), None)
    }

    #[test]
    fn splits_bullets_and_strips_frontmatter_and_tags() {
        let files = vec![claude_file(
            "/topics/fitness.md",
            "---\nname: fitness\ndescription: x\n---\n- [stated] Strong interest in fitness\n- [stated] Previously practised yoga\n",
        )];
        let mems = parse_claude_account_memories(&files);
        assert_eq!(mems.len(), 2);
        assert_eq!(mems[0].content, "Strong interest in fitness");
        assert_eq!(mems[1].content, "Previously practised yoga");
        assert_eq!(mems[0].category, "Topics");
        assert_eq!(mems[0].label, "Fitness");
        assert_eq!(mems[0].kind, ImportedMemoryKind::Fact);
    }

    #[test]
    fn preferences_are_classified_as_preferences() {
        let files = vec![claude_file(
            "/preferences.md",
            "---\nname: preferences\n---\n- [stated] Prefers direct, low-fluff communication\n",
        )];
        let mems = parse_claude_account_memories(&files);
        assert_eq!(mems.len(), 1);
        assert_eq!(mems[0].kind, ImportedMemoryKind::Preference);
        assert_eq!(mems[0].kind.as_db_value(), "preference");
        // A top-level file has no directory to name it.
        assert_eq!(mems[0].category, "Profile");
    }

    #[test]
    fn keys_are_stable_and_unique_per_bullet() {
        let files = vec![claude_file("/profile.md", "- [stated] A\n- [stated] B\n")];
        let mems = parse_claude_account_memories(&files);
        assert_eq!(mems[0].key, "profile.md#0");
        assert_eq!(mems[1].key, "profile.md#1");
        // Re-parsing the same export must reproduce the same keys.
        let again = parse_claude_account_memories(&files);
        assert_eq!(mems[0].key, again[0].key);
    }

    #[test]
    fn unrecognised_body_imports_whole_rather_than_nothing() {
        let files = vec![claude_file("/notes.md", "Just a paragraph, no bullets.")];
        let mems = parse_claude_account_memories(&files);
        assert_eq!(mems.len(), 1);
        assert_eq!(mems[0].content, "Just a paragraph, no bullets.");
    }

    #[test]
    fn empty_file_yields_nothing() {
        let files = vec![claude_file("/empty.md", "---\nname: empty\n---\n")];
        assert!(parse_claude_account_memories(&files).is_empty());
    }

    #[test]
    fn account_keys_cannot_collide_with_project_uuids() {
        let key = account_link_key("profile.md#0");
        assert!(key.starts_with(ACCOUNT_KEY_PREFIX));
        // A real project uuid never contains the prefix.
        assert!(!"0199c60b-7f81-7507-8335-c9b20fb3ddfe".contains(ACCOUNT_KEY_PREFIX));
    }
}

/// Round-trip tests for account-memory persistence, exercising the same
/// upsert-on-hash logic the import command uses against a real schema.
#[cfg(test)]
mod persistence_tests {
    use super::*;
    use crate::db::test_utils::tests::setup_test_db;
    use crate::services::chat_file_store::import_links::{
        self, memory_content_hash, SOURCE_CLAUDE,
    };

    /// Mirror of the command's per-memory upsert, so the test covers the
    /// decision logic without needing a Tauri State.
    fn import_one(conn: &rusqlite::Connection, mem: &ImportedMemory) -> &'static str {
        let links = import_links::load_memory_links(conn, SOURCE_CLAUDE).unwrap();
        let link_key = account_link_key(&mem.key);
        let hash = memory_content_hash(&mem.content);
        let now = "2026-08-30T00:00:00Z";

        match links.get(&link_key) {
            Some((_, prior)) if *prior == hash => "skipped",
            Some((mem_id, _)) => {
                conn.execute(
                    "UPDATE memories SET content = ?1, updated_at = ?2 WHERE id = ?3",
                    rusqlite::params![mem.content, now, mem_id],
                )
                .unwrap();
                import_links::upsert_memory_link(conn, SOURCE_CLAUDE, &link_key, mem_id, &hash, now)
                    .unwrap();
                "updated"
            }
            None => {
                let id = uuid::Uuid::new_v4().to_string();
                conn.execute(
                    "INSERT INTO memories
                         (id, workspace_id, folder_id, content, memory_type, scope,
                          is_pinned, is_active, created_at, updated_at)
                     VALUES (?1, NULL, '', ?2, ?3, 'global', 0, 1, ?4, ?4)",
                    rusqlite::params![id, mem.content, mem.kind.as_db_value(), now],
                )
                .unwrap();
                import_links::upsert_memory_link(conn, SOURCE_CLAUDE, &link_key, &id, &hash, now)
                    .unwrap();
                "imported"
            }
        }
    }

    fn memory(key: &str, content: &str) -> ImportedMemory {
        ImportedMemory {
            key: key.to_string(),
            category: "Topics".into(),
            label: "Fitness".into(),
            content: content.to_string(),
            kind: ImportedMemoryKind::Fact,
            updated_at: None,
        }
    }

    fn count_memories(conn: &rusqlite::Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM memories", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn import_then_reimport_is_idempotent_and_updates_in_place() {
        let db = setup_test_db();
        let conn = db.get().unwrap();

        let m = memory("topics/fitness.md#0", "Strong interest in fitness");
        assert_eq!(import_one(&conn, &m), "imported");
        assert_eq!(count_memories(&conn), 1);

        // Unchanged re-import must not duplicate.
        assert_eq!(import_one(&conn, &m), "skipped");
        assert_eq!(count_memories(&conn), 1);

        // Changed upstream: same key, new text — updates the existing row.
        let changed = memory("topics/fitness.md#0", "Returned to weight training");
        assert_eq!(import_one(&conn, &changed), "updated");
        assert_eq!(count_memories(&conn), 1);

        let stored: String = conn
            .query_row("SELECT content FROM memories", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stored, "Returned to weight training");
    }

    #[test]
    fn multiple_account_memories_coexist() {
        let db = setup_test_db();
        let conn = db.get().unwrap();

        // The pre-existing UNIQUE(source, source_project_uuid) would collide if
        // account memories shared one key — each must namespace its own.
        for (i, text) in ["fact one", "fact two", "fact three"].iter().enumerate() {
            let m = memory(&format!("profile.md#{i}"), text);
            assert_eq!(import_one(&conn, &m), "imported");
        }
        assert_eq!(count_memories(&conn), 3);
    }

    #[test]
    fn account_memories_do_not_collide_with_project_memories() {
        let db = setup_test_db();
        let conn = db.get().unwrap();

        // A project memory keyed by a real project uuid.
        let project_uuid = "0199c60b-7f81-7507-8335-c9b20fb3ddfe";
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO memories (id, workspace_id, folder_id, content, memory_type, scope,
                                   is_pinned, is_active, created_at, updated_at)
             VALUES (?1, NULL, '', 'project memory', 'fact', 'global', 0, 1, ?2, ?2)",
            rusqlite::params![id, "2026-08-30T00:00:00Z"],
        )
        .unwrap();
        import_links::upsert_memory_link(
            &conn,
            SOURCE_CLAUDE,
            project_uuid,
            &id,
            &memory_content_hash("project memory"),
            "2026-08-30T00:00:00Z",
        )
        .unwrap();

        // An account memory alongside it must import cleanly.
        let m = memory("profile.md#0", "account memory");
        assert_eq!(import_one(&conn, &m), "imported");
        assert_eq!(count_memories(&conn), 2);
    }

    #[test]
    fn preference_kind_satisfies_schema_check() {
        let db = setup_test_db();
        let conn = db.get().unwrap();
        let mut m = memory("preferences.md#0", "Prefers direct communication");
        m.kind = ImportedMemoryKind::Preference;
        assert_eq!(import_one(&conn, &m), "imported");

        let stored: String = conn
            .query_row("SELECT memory_type FROM memories", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stored, "preference");
    }
}
