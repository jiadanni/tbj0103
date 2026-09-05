use crate::services::chat_file_store::{self, SessionFileVariants};
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

// Serialize relocations/retries, not SQLite writers. File work always happens
// after commit, and must not race another move's path capture and cleanup.
static RELOCATION_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Default, Serialize)]
pub struct FileSyncStatus {
    pub file_sync_pending: bool,
    pub file_sync_error: Option<String>,
}

pub fn lock_relocations() -> Result<MutexGuard<'static, ()>, String> {
    RELOCATION_LOCK.lock().map_err(|e| e.to_string())
}

pub fn enqueue(
    conn: &Connection,
    previous: &HashMap<String, SessionFileVariants>,
    encrypted: bool,
) -> Result<(), String> {
    if conn.is_autocommit() {
        return Err("Chat file synchronization must be queued in the move transaction".into());
    }
    for (session_id, paths) in previous {
        conn.execute(
            "INSERT INTO chat_file_sync_outbox
             (id, session_id, previous_plain, previous_encrypted, requires_encryption)
             SELECT ?1, id, ?3, ?4, ?5 FROM chat_sessions WHERE id = ?2",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                session_id,
                serde_json::to_string(&paths.plain).map_err(|e| e.to_string())?,
                serde_json::to_string(&paths.encrypted).map_err(|e| e.to_string())?,
                encrypted,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn enqueue_deletion(
    conn: &Connection,
    previous: &HashMap<String, SessionFileVariants>,
) -> Result<(), String> {
    if conn.is_autocommit() {
        return Err("Chat file deletion must be queued in the delete transaction".into());
    }
    for (session_id, paths) in previous {
        chat_file_store::validate_session_id(session_id)?;
        conn.execute(
            "INSERT INTO chat_file_delete_outbox
             (id, session_id, previous_plain, previous_encrypted)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                session_id,
                serde_json::to_string(&paths.plain).map_err(|e| e.to_string())?,
                serde_json::to_string(&paths.encrypted).map_err(|e| e.to_string())?,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Drain deletion tombstones under the relocation lock, after the SQL commit.
/// Retain a failed record, including untrusted paths rejected by containment
/// validation, rather than losing the only remaining record of an old file.
pub fn sync_deletions(conn: &Connection, chats_dir: &Path) -> Result<(), String> {
    if !conn.is_autocommit() {
        return Err("Refusing chat file deletion while a database transaction is open".into());
    }
    let jobs = conn
        .prepare(
            "SELECT id, session_id, previous_plain, previous_encrypted
             FROM chat_file_delete_outbox ORDER BY created_at, id",
        )
        .map_err(|e| e.to_string())?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut failures = Vec::new();
    for (id, session_id, plain, encrypted) in jobs {
        let result = (|| {
            let exists: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM chat_sessions WHERE id = ?1)",
                    [&session_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if exists {
                return Err(
                    "Session ID has been reused; file cleanup deferred to protect the replacement"
                        .into(),
                );
            }
            let paths = SessionFileVariants {
                plain: serde_json::from_str::<PathBuf>(&plain).map_err(|e| e.to_string())?,
                encrypted: serde_json::from_str::<PathBuf>(&encrypted)
                    .map_err(|e| e.to_string())?,
            };
            chat_file_store::delete_session_file_variants(chats_dir, &paths, &session_id)?;
            conn.execute("DELETE FROM chat_file_delete_outbox WHERE id = ?1", [&id])
                .map_err(|e| e.to_string())?;
            Ok::<(), String>(())
        })();
        if let Err(error) = result {
            failures.push(format!("{session_id}: {error}"));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Chat deletion is committed in the database, but file cleanup is pending. \
             It will retry on the next move or app startup. {}",
            failures.join("; ")
        ))
    }
}

/// Caller holds the relocation lock. Errors describe pending file work, never
/// imply that an already committed chat move was rolled back.
pub fn sync_pending(
    conn: &Connection,
    chats_dir: &Path,
    passphrase: Option<&str>,
) -> FileSyncStatus {
    let deletions = sync_deletions(conn, chats_dir);
    let moves = drain_with(conn, passphrase, |session_id, previous| {
        chat_file_store::sync_session_files_for_hierarchy_change(
            conn,
            chats_dir,
            &[session_id.to_string()],
            &HashMap::from([(session_id.to_string(), previous)]),
            passphrase,
        )
    });
    let result = match (moves, deletions) {
        (Err(moves), Err(deletions)) => Err(format!("{moves}; {deletions}")),
        (Err(error), _) | (_, Err(error)) => Err(error),
        (Ok(()), Ok(())) => Ok(()),
    };
    match result {
        Ok(()) => FileSyncStatus::default(),
        Err(error) => FileSyncStatus {
            file_sync_pending: true,
            file_sync_error: Some(format!(
                "Chat changes are saved in the database, but file synchronization is pending. \
                 It will retry on the next move or app startup. {error}"
            )),
        },
    }
}

fn drain_with(
    conn: &Connection,
    passphrase: Option<&str>,
    mut sync: impl FnMut(&str, SessionFileVariants) -> Result<(), String>,
) -> Result<(), String> {
    if !conn.is_autocommit() {
        return Err("Refusing chat file I/O while a database transaction is open".into());
    }
    let jobs = conn
        .prepare(
            "SELECT id, session_id, previous_plain, previous_encrypted, requires_encryption
             FROM chat_file_sync_outbox ORDER BY created_at, id",
        )
        .map_err(|e| e.to_string())?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, bool>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let encryption_enabled: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'chat_encryption_enabled'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let mut failures = Vec::new();
    for (id, session_id, plain, encrypted, required) in jobs {
        let result = (|| {
            let required = match encryption_enabled.as_deref() {
                Some("true") => true,
                Some("false") => false,
                _ => required,
            };
            if required && passphrase.is_none() {
                return Err(
                    "Chat encryption key is unavailable; encrypted files were preserved".into(),
                );
            }
            sync(
                &session_id,
                SessionFileVariants {
                    plain: serde_json::from_str::<PathBuf>(&plain).map_err(|e| e.to_string())?,
                    encrypted: serde_json::from_str::<PathBuf>(&encrypted)
                        .map_err(|e| e.to_string())?,
                },
            )?;
            conn.execute("DELETE FROM chat_file_sync_outbox WHERE id = ?1", [&id])
                .map_err(|e| e.to_string())?;
            Ok::<(), String>(())
        })();
        if let Err(error) = result {
            failures.push(format!("{session_id}: {error}"));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_delete_outbox_upgrade_preserves_cascade_origins_and_rejects_untrusted_paths() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("upgrade.sqlite");
        let pool = crate::db::initialize_database(&db_path).unwrap();
        let conn = pool.get().unwrap();
        conn.execute_batch(
            "DROP TRIGGER chat_file_sync_preserve_deleted_origins;
             DROP TABLE chat_file_delete_outbox;
             DELETE FROM _migrations WHERE name = 'v83_chat_file_delete_outbox';
             INSERT INTO workspaces(id, name) VALUES ('ws', 'Workspace');
             INSERT INTO chat_sessions(id, workspace_id, title) VALUES ('session', 'ws', 'Chat');",
        )
        .unwrap();
        let chats = dir.path().join("chats");
        std::fs::create_dir_all(&chats).unwrap();
        let outside = dir.path().join("outside.json");
        std::fs::write(&outside, b"must survive").unwrap();
        let previous = HashMap::from([(
            "session".to_string(),
            SessionFileVariants {
                plain: outside.clone(),
                encrypted: chats.join("session.json.enc"),
            },
        )]);
        let tx = conn.unchecked_transaction().unwrap();
        enqueue(&tx, &previous, false).unwrap();
        tx.commit().unwrap();
        drop(conn);
        drop(pool);

        let pool = crate::db::initialize_database(&db_path).unwrap();
        let conn = pool.get().unwrap();
        let _relocation = lock_relocations().unwrap();
        // A workspace cascade must also preserve pending paths, even if it
        // bypasses the explicit hard-delete service.
        conn.execute("DELETE FROM workspaces WHERE id = 'ws'", [])
            .unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM chat_file_sync_outbox", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM chat_file_delete_outbox", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert!(sync_deletions(&conn, &chats)
            .unwrap_err()
            .contains("outside"));
        assert_eq!(std::fs::read(&outside).unwrap(), b"must survive");
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM chat_file_delete_outbox", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            0
        );
    }

    #[test]
    fn storage_delete_tombstone_does_not_remove_replacement_session() {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::initialize_database(&dir.path().join("replacement.sqlite")).unwrap();
        let conn = pool.get().unwrap();
        let chats = dir.path().join("chats");
        std::fs::create_dir_all(&chats).unwrap();
        let paths = SessionFileVariants {
            plain: chats.join("reused.json"),
            encrypted: chats.join("reused.json.enc"),
        };
        let _relocation = lock_relocations().unwrap();
        let tx = conn.unchecked_transaction().unwrap();
        enqueue_deletion(&tx, &HashMap::from([("reused".into(), paths.clone())]))
        .unwrap();
        tx.commit().unwrap();
        conn.execute_batch(
            "INSERT INTO workspaces(id, name) VALUES ('ws', 'Workspace');
             INSERT INTO chat_sessions(id, workspace_id, title) VALUES ('reused', 'ws', 'Replacement');",
        ).unwrap();
        std::fs::write(&paths.plain, b"replacement").unwrap();
        assert!(sync_deletions(&conn, &chats)
            .unwrap_err()
            .contains("reused"));
        assert_eq!(std::fs::read(&paths.plain).unwrap(), b"replacement");
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM chat_file_delete_outbox", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn storage_outbox_retries_after_commit_without_holding_writer_lock() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("outbox.sqlite");
        let pool = crate::db::initialize_database(&path).unwrap();
        let conn = pool.get().unwrap();
        conn.execute_batch(
            "INSERT INTO workspaces(id, name) VALUES ('old', 'Old'), ('new', 'New');
             INSERT INTO chat_sessions(id, workspace_id, title) VALUES ('session', 'old', 'Chat');",
        )
        .unwrap();
        let previous = HashMap::from([(
            "session".to_string(),
            SessionFileVariants {
                plain: dir.path().join("old.json"),
                encrypted: dir.path().join("old.json.enc"),
            },
        )]);
        let tx = conn.unchecked_transaction().unwrap();
        tx.execute(
            "UPDATE chat_sessions SET workspace_id = 'new' WHERE id = 'session'",
            [],
        )
        .unwrap();
        enqueue(&tx, &previous, false).unwrap();
        assert!(drain_with(&tx, None, |_, _| panic!("I/O inside transaction")).is_err());
        tx.commit().unwrap();
        let other = rusqlite::Connection::open(&path).unwrap();
        assert!(drain_with(&conn, None, |_, _| {
            other.execute_batch("BEGIN IMMEDIATE; COMMIT;").unwrap();
            Err("synthetic file error".into())
        })
        .is_err());
        drop(conn);
        drop(pool);

        let pool = crate::db::initialize_database(&path).unwrap();
        let conn = pool.get().unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT workspace_id FROM chat_sessions WHERE id = 'session'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "new"
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM chat_file_sync_outbox", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        drain_with(&conn, None, |_, paths| {
            assert_eq!(paths.plain, previous["session"].plain);
            other.execute_batch("BEGIN IMMEDIATE; COMMIT;").unwrap();
            Ok(())
        })
        .unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM chat_file_sync_outbox", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        drain_with(&conn, None, |_, _| panic!("Already synchronized")).unwrap();

        let tx = conn.unchecked_transaction().unwrap();
        enqueue(&tx, &previous, true).unwrap();
        tx.commit().unwrap();
        assert!(drain_with(&conn, None, |_, _| panic!("Must not write plaintext")).is_err());
        drain_with(&conn, Some("test-only-key"), |_, _| Ok(())).unwrap();
    }
}
