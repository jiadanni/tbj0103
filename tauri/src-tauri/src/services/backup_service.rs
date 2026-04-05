//! Backup service manifest helpers.
//! Full backup/restore logic lives in commands/backup.rs.
//! This module provides manifest serialisation and pruning utilities.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BackupManifest {
    pub version: String,
    pub entries: Vec<BackupEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupEntry {
    pub id: String,
    pub created_at: String,
    pub size_bytes: i64,
    pub workspace_id: String,
    pub filename: String,
}

impl BackupManifest {
    pub fn new() -> Self {
        Self {
            version: "1.0".into(),
            entries: Vec::new(),
        }
    }

    /// Keep only the newest `keep` entries, deleting older ones.
    pub fn prune(&mut self, keep: usize) {
        self.entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        self.entries.truncate(keep);
    }

    pub fn from_json(json: &str) -> Result<Self, String> {
        serde_json::from_str(json).map_err(|e| e.to_string())
    }

    pub fn to_json(&self) -> Result<String, String> {
        serde_json::to_string_pretty(self).map_err(|e| e.to_string())
    }
}
