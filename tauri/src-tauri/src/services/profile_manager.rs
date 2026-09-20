use std::fs;
use std::path::{Path, PathBuf};
use chrono::Utc;
use serde::{Deserialize, Serialize};

pub const PROFILES_FILENAME: &str = "profiles.json";
pub const DEFAULT_PROFILE_ID: &str = "default";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppProfile {
    pub id: String,
    pub name: String,
    pub description: String,
    pub created_at: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfilesConfig {
    pub active_profile_id: String,
    pub profiles: Vec<AppProfile>,
}

impl Default for ProfilesConfig {
    fn default() -> Self {
        Self {
            active_profile_id: DEFAULT_PROFILE_ID.to_string(),
            profiles: vec![AppProfile {
                id: DEFAULT_PROFILE_ID.to_string(),
                name: "Default".to_string(),
                description: "Primary workspace vault".to_string(),
                created_at: Utc::now().to_rfc3339(),
                is_default: true,
            }],
        }
    }
}

pub fn profiles_config_path(app_dir: &Path) -> PathBuf {
    app_dir.join(PROFILES_FILENAME)
}

pub fn load_profiles_config(app_dir: &Path) -> ProfilesConfig {
    let path = profiles_config_path(app_dir);
    if !path.exists() {
        let default_config = ProfilesConfig::default();
        let _ = save_profiles_config(app_dir, &default_config);
        return default_config;
    }

    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<ProfilesConfig>(&content) {
            Ok(mut config) => {
                // Ensure default profile exists
                if !config.profiles.iter().any(|p| p.id == DEFAULT_PROFILE_ID) {
                    config.profiles.insert(
                        0,
                        AppProfile {
                            id: DEFAULT_PROFILE_ID.to_string(),
                            name: "Default".to_string(),
                            description: "Primary workspace vault".to_string(),
                            created_at: Utc::now().to_rfc3339(),
                            is_default: true,
                        },
                    );
                }
                // Ensure active profile is valid
                if !config.profiles.iter().any(|p| p.id == config.active_profile_id) {
                    config.active_profile_id = DEFAULT_PROFILE_ID.to_string();
                }
                config
            }
            Err(e) => {
                crate::logging::log_error(
                    "profile_manager",
                    format!("Corrupted profiles.json: {e}; restoring defaults"),
                );
                ProfilesConfig::default()
            }
        },
        Err(e) => {
            crate::logging::log_error(
                "profile_manager",
                format!("Failed to read profiles.json: {e}; restoring defaults"),
            );
            ProfilesConfig::default()
        }
    }
}

pub fn save_profiles_config(app_dir: &Path, config: &ProfilesConfig) -> Result<(), String> {
    let path = profiles_config_path(app_dir);
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| format!("Failed to write profiles.json: {e}"))
}

pub fn resolve_profile_paths(app_dir: &Path, profile_id: &str) -> (PathBuf, PathBuf) {
    if profile_id == DEFAULT_PROFILE_ID {
        (app_dir.join("aetherium.db"), app_dir.join("chats"))
    } else {
        let vault_dir = app_dir.join("vaults").join(profile_id);
        (vault_dir.join("aetherium.db"), vault_dir.join("chats"))
    }
}

pub fn get_active_profile_and_paths(app_dir: &Path) -> (AppProfile, PathBuf, PathBuf) {
    let config = load_profiles_config(app_dir);
    let active = config
        .profiles
        .iter()
        .find(|p| p.id == config.active_profile_id)
        .cloned()
        .unwrap_or_else(|| AppProfile {
            id: DEFAULT_PROFILE_ID.to_string(),
            name: "Default".to_string(),
            description: "Primary workspace vault".to_string(),
            created_at: Utc::now().to_rfc3339(),
            is_default: true,
        });

    let (db_path, chats_dir) = resolve_profile_paths(app_dir, &active.id);
    (active, db_path, chats_dir)
}

fn slugify_name(name: &str) -> String {
    let mut slug = String::new();
    let mut prev_dash = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            slug.push('-');
            prev_dash = true;
        }
    }
    let trimmed = slug.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "vault".to_string()
    } else {
        trimmed
    }
}

pub fn create_profile(
    app_dir: &Path,
    name: &str,
    description: Option<&str>,
) -> Result<AppProfile, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("Profile name cannot be empty".to_string());
    }

    let mut config = load_profiles_config(app_dir);
    let base_id = slugify_name(trimmed_name);
    let mut candidate_id = base_id.clone();
    let mut suffix = 2;

    while candidate_id == DEFAULT_PROFILE_ID
        || config.profiles.iter().any(|p| p.id == candidate_id)
    {
        candidate_id = format!("{base_id}-{suffix}");
        suffix += 1;
    }

    let (_, chats_dir) = resolve_profile_paths(app_dir, &candidate_id);
    fs::create_dir_all(&chats_dir).map_err(|e| format!("Failed to create vault directory: {e}"))?;

    let profile = AppProfile {
        id: candidate_id,
        name: trimmed_name.to_string(),
        description: description.unwrap_or("").trim().to_string(),
        created_at: Utc::now().to_rfc3339(),
        is_default: false,
    };

    config.profiles.push(profile.clone());
    save_profiles_config(app_dir, &config)?;

    Ok(profile)
}

pub fn switch_active_profile(app_dir: &Path, profile_id: &str) -> Result<AppProfile, String> {
    let mut config = load_profiles_config(app_dir);
    let profile = config
        .profiles
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .ok_or_else(|| format!("Profile '{profile_id}' not found"))?;

    if config.active_profile_id != profile_id {
        config.active_profile_id = profile_id.to_string();
        save_profiles_config(app_dir, &config)?;
    }

    Ok(profile)
}

pub fn rename_profile(
    app_dir: &Path,
    profile_id: &str,
    new_name: &str,
    new_description: Option<&str>,
) -> Result<AppProfile, String> {
    let trimmed_name = new_name.trim();
    if trimmed_name.is_empty() {
        return Err("Profile name cannot be empty".to_string());
    }

    let mut config = load_profiles_config(app_dir);
    let profile = config
        .profiles
        .iter_mut()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| format!("Profile '{profile_id}' not found"))?;

    profile.name = trimmed_name.to_string();
    if let Some(desc) = new_description {
        profile.description = desc.trim().to_string();
    }
    let updated = profile.clone();
    save_profiles_config(app_dir, &config)?;

    Ok(updated)
}

pub fn delete_profile(app_dir: &Path, profile_id: &str) -> Result<(), String> {
    if profile_id == DEFAULT_PROFILE_ID {
        return Err("The Default profile cannot be deleted.".to_string());
    }

    let mut config = load_profiles_config(app_dir);
    if profile_id == config.active_profile_id {
        return Err("Cannot delete the currently active profile. Switch to another profile first.".to_string());
    }

    let initial_len = config.profiles.len();
    config.profiles.retain(|p| p.id != profile_id);
    if config.profiles.len() == initial_len {
        return Err(format!("Profile '{profile_id}' not found"));
    }

    save_profiles_config(app_dir, &config)?;

    // Clean up vault folder if it exists
    let vault_dir = app_dir.join("vaults").join(profile_id);
    if vault_dir.exists() {
        let _ = fs::remove_dir_all(&vault_dir);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_default_config_initialization() {
        let temp = tempdir().unwrap();
        let app_dir = temp.path();

        let config = load_profiles_config(app_dir);
        assert_eq!(config.active_profile_id, DEFAULT_PROFILE_ID);
        assert_eq!(config.profiles.len(), 1);
        assert_eq!(config.profiles[0].id, DEFAULT_PROFILE_ID);
        assert!(config.profiles[0].is_default);

        let (db_path, chats_dir) = resolve_profile_paths(app_dir, DEFAULT_PROFILE_ID);
        assert_eq!(db_path, app_dir.join("aetherium.db"));
        assert_eq!(chats_dir, app_dir.join("chats"));
    }

    #[test]
    fn test_create_switch_rename_delete_lifecycle() {
        let temp = tempdir().unwrap();
        let app_dir = temp.path();

        let p1 = create_profile(app_dir, "Claude Archive", Some("Legacy chats")).unwrap();
        assert_eq!(p1.id, "claude-archive");
        assert_eq!(p1.name, "Claude Archive");
        assert_eq!(p1.description, "Legacy chats");
        assert!(!p1.is_default);

        let (db_path, chats_dir) = resolve_profile_paths(app_dir, &p1.id);
        assert_eq!(db_path, app_dir.join("vaults/claude-archive/aetherium.db"));
        assert!(chats_dir.exists());

        // Slug collision
        let p2 = create_profile(app_dir, "Claude Archive", None).unwrap();
        assert_eq!(p2.id, "claude-archive-2");

        // Switch
        let switched = switch_active_profile(app_dir, &p1.id).unwrap();
        assert_eq!(switched.id, p1.id);
        let config = load_profiles_config(app_dir);
        assert_eq!(config.active_profile_id, p1.id);

        // Cannot delete active profile
        let err = delete_profile(app_dir, &p1.id).unwrap_err();
        assert!(err.contains("active profile"));

        // Rename
        let renamed = rename_profile(app_dir, &p2.id, "Renamed Claude", Some("New desc")).unwrap();
        assert_eq!(renamed.name, "Renamed Claude");

        // Switch back to default
        switch_active_profile(app_dir, DEFAULT_PROFILE_ID).unwrap();

        // Now can delete p1
        delete_profile(app_dir, &p1.id).unwrap();
        let config_after = load_profiles_config(app_dir);
        assert!(!config_after.profiles.iter().any(|p| p.id == p1.id));
        assert!(!app_dir.join("vaults/claude-archive").exists());

        // Cannot delete default
        let default_err = delete_profile(app_dir, DEFAULT_PROFILE_ID).unwrap_err();
        assert!(default_err.contains("Default profile cannot be deleted"));
    }
}
