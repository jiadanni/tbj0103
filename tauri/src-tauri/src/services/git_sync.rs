use std::path::{Path, PathBuf};
use std::process::Command;

fn git(repo: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(repo)
        .env("GIT_EDITOR", "true") // prevent editor prompts in programmatic usage
        .output()
        .map_err(|e| format!("git {}: {}", args[0], e))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Ensure `repo_dir` is a git repo with the given remote URL.
/// Creates the repo and writes a .gitignore on first call.
pub fn ensure_repo(repo_dir: &Path, remote_url: &str) -> Result<(), String> {
    if !repo_dir.join(".git").exists() {
        git(repo_dir, &["init"])?;
        write_gitignore(repo_dir)?;
    }

    // Set or update the remote
    let remotes = git(repo_dir, &["remote"]).unwrap_or_default();
    if remotes.contains("origin") {
        git(repo_dir, &["remote", "set-url", "origin", remote_url])?;
    } else {
        git(repo_dir, &["remote", "add", "origin", remote_url])?;
    }
    Ok(())
}

fn write_gitignore(repo_dir: &Path) -> Result<(), String> {
    let path = repo_dir.join(".gitignore");
    let content = "# Ignore vector index blobs and temp files\n*.tmp\nvector_index/\n";
    std::fs::write(path, content).map_err(|e| e.to_string())
}

/// Commit any pending changes.  Returns true if a new commit was made.
fn commit_if_dirty(repo_dir: &Path) -> Result<bool, String> {
    git(repo_dir, &["add", "-A"])?;
    let status = git(repo_dir, &["status", "--porcelain"])?;
    if status.is_empty() {
        return Ok(false);
    }
    let ts = chrono::Utc::now().to_rfc3339();
    git(repo_dir, &["commit", "-m", &format!("sync: {}", ts)])?;
    Ok(true)
}

pub struct SyncResult {
    pub pulled: bool,
    pub pushed: bool,
    pub conflict: bool,
    pub error: Option<String>,
}

/// Full sync cycle: pull --rebase, then push.
pub fn sync(repo_dir: &Path) -> SyncResult {
    let mut result = SyncResult {
        pulled: false,
        pushed: false,
        conflict: false,
        error: None,
    };

    // Commit local changes first
    if let Err(e) = commit_if_dirty(repo_dir) {
        result.error = Some(e);
        return result;
    }

    // Pull with rebase
    match git(repo_dir, &["pull", "--rebase", "origin", "main"]) {
        Ok(_) => result.pulled = true,
        Err(e) => {
            if e.contains("CONFLICT") || e.contains("conflict") {
                // Auto-resolve: pick the version with the newer updated_at for each file
                match auto_resolve_rebase(repo_dir) {
                    Ok(_) => result.pulled = true,
                    Err(resolve_err) => {
                        let _ = git(repo_dir, &["rebase", "--abort"]);
                        result.conflict = true;
                        result.error = Some(resolve_err);
                        return result;
                    }
                }
            } else if e.contains("couldn't find remote ref")
                || e.contains("does not appear to be a git")
            {
                // Remote has no commits yet — first push
            } else {
                result.error = Some(e);
                return result;
            }
        }
    }

    // Push
    match git(repo_dir, &["push", "-u", "origin", "main"]) {
        Ok(_) => result.pushed = true,
        Err(e) => {
            // If remote has no `main` branch yet, try with --set-upstream
            if e.contains("src refspec main") || e.contains("does not match any") {
                // Possibly empty remote — push HEAD
                match git(repo_dir, &["push", "-u", "origin", "HEAD:main"]) {
                    Ok(_) => result.pushed = true,
                    Err(e2) => result.error = Some(e2),
                }
            } else {
                result.error = Some(e);
            }
        }
    }

    result
}

// ── Auto-conflict resolution ────────────────────────────────────────────────

/// Resolve all rebase conflicts by comparing `updated_at` timestamps in JSON
/// chat files and keeping the newer version. Non-JSON files default to keeping
/// the local (being-replayed) version. Loops until the rebase finishes.
fn auto_resolve_rebase(repo_dir: &Path) -> Result<(), String> {
    const MAX_ROUNDS: usize = 50;
    for _ in 0..MAX_ROUNDS {
        // Discover which files have unmerged conflicts
        let conflicted =
            git(repo_dir, &["diff", "--name-only", "--diff-filter=U"]).unwrap_or_default();

        if conflicted.trim().is_empty() {
            // No conflicts right now — check if the rebase is still in progress
            if repo_dir.join(".git/rebase-merge").exists()
                || repo_dir.join(".git/rebase-apply").exists()
            {
                match git(repo_dir, &["rebase", "--continue"]) {
                    Ok(_) => return Ok(()),
                    Err(e) if e.contains("No changes") => {
                        let _ = git(repo_dir, &["rebase", "--skip"]);
                        continue;
                    }
                    Err(e) if e.contains("CONFLICT") || e.contains("conflict") => continue,
                    Err(e) => return Err(e),
                }
            }
            return Ok(());
        }

        for file in conflicted.lines() {
            let file = file.trim();
            if file.is_empty() {
                continue;
            }
            resolve_single_file(repo_dir, file)?;
        }

        // Continue after resolving this round of conflicts
        match git(repo_dir, &["rebase", "--continue"]) {
            Ok(_) => return Ok(()),
            Err(e) if e.contains("No changes") => {
                let _ = git(repo_dir, &["rebase", "--skip"]);
                continue;
            }
            Err(e) if e.contains("CONFLICT") || e.contains("conflict") => continue,
            Err(e) => return Err(e),
        }
    }
    Err("Too many rebase conflict rounds — aborting".to_string())
}

/// Resolve a single conflicted file by picking the version with the newer
/// `updated_at` timestamp. Falls back to the local version if parsing fails.
fn resolve_single_file(repo_dir: &Path, file: &str) -> Result<(), String> {
    // During rebase: stage 2 = target branch (remote), stage 3 = commit being replayed (local)
    let remote = git(repo_dir, &["show", &format!(":2:{}", file)]).ok();
    let local = git(repo_dir, &["show", &format!(":3:{}", file)]).ok();
    let chosen = pick_newer_version(remote.as_deref(), local.as_deref());

    let file_path = repo_dir.join(file);
    std::fs::write(&file_path, chosen).map_err(|e| format!("write {}: {}", file, e))?;
    git(repo_dir, &["add", file])?;
    Ok(())
}

/// Compare two JSON blobs by their `updated_at` field and return the newer one.
/// Falls back to the local version if timestamps can't be compared.
fn pick_newer_version(remote: Option<&str>, local: Option<&str>) -> String {
    fn extract_updated_at(json_str: &str) -> Option<String> {
        serde_json::from_str::<serde_json::Value>(json_str)
            .ok()
            .and_then(|v| v.get("updated_at")?.as_str().map(String::from))
    }

    let remote_ts = remote.and_then(extract_updated_at);
    let local_ts = local.and_then(extract_updated_at);

    match (&remote_ts, &local_ts) {
        (Some(r), Some(l)) if l >= r => local.unwrap_or("").to_string(),
        (Some(_), Some(_)) => remote.unwrap_or("").to_string(),
        _ => {
            // Can't compare timestamps — prefer local, fall back to remote
            local.or(remote).unwrap_or("").to_string()
        }
    }
}

/// Determine the app data dir that should be tracked.
pub fn data_dir_from_app_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.to_path_buf()
}
