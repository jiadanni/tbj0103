use std::path::{Path, PathBuf};
use std::process::Command;

fn git(repo: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(repo)
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
                result.conflict = true;
                result.error = Some(
                    "Rebase conflict — open a terminal and resolve manually in the data directory."
                        .to_string(),
                );
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

    if result.conflict {
        return result;
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

/// Determine the app data dir that should be tracked.
pub fn data_dir_from_app_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.to_path_buf()
}
