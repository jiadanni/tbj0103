use crate::models::glossary::ResolvedWorkspaceGlossaryTerm;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

fn resolve_dictionary_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled_path = resource_dir.join("resources").join("dictionary.db");
        if bundled_path.exists() {
            return Ok(bundled_path);
        }
        let bundled_path_flat = resource_dir.join("dictionary.db");
        if bundled_path_flat.exists() {
            return Ok(bundled_path_flat);
        }
    }

    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("dictionary.db");
    if dev_path.exists() {
        return Ok(dev_path);
    }

    Err("dictionary.db not found".to_string())
}

pub fn lookup_word<R: Runtime>(
    app: &AppHandle<R>,
    word: &str,
) -> Result<Option<ResolvedWorkspaceGlossaryTerm>, String> {
    let db_path = resolve_dictionary_path(app)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let normalized = word.trim().to_lowercase();

    let result = conn
        .query_row(
            "SELECT word, wordtype, definition FROM entries WHERE word = ?1 LIMIT 1",
            params![normalized],
            |row| {
                let term: String = row.get(0)?;
                let wordtype: Option<String> = row.get(1)?;
                let definition: String = row.get(2)?;

                let formatted_definition = if let Some(wt) = wordtype {
                    if !wt.trim().is_empty() {
                        format!("({}) {}", wt.trim(), definition.trim())
                    } else {
                        definition.trim().to_string()
                    }
                } else {
                    definition.trim().to_string()
                };

                Ok(ResolvedWorkspaceGlossaryTerm {
                    term,
                    normalized_term: normalized.clone(),
                    definition: formatted_definition,
                    aliases: Vec::new(),
                    source_kind: "dictionary".to_string(),
                    workspace_id: "global".to_string(),
                    workspace_name: Some("Offline Dictionary".to_string()),
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    Ok(result)
}
