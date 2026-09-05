use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

static SYNC_LOCK: Mutex<()> = Mutex::new(());

const HISTORY_WARNING: &str = "Existing Git history may contain browser sessions, cookies, or secrets. Removing files from the index does not remove history. Use a new empty repository and revoke exposed sessions/credentials; history is never rewritten automatically.";

// ChatFileStore writes chats/{workspace}/{folder}/{id}.json[.enc], plus legacy
// flat files. The database and settings are not portable, secret-free exports.
fn allowed_path(file: &str) -> bool {
    let parts: Vec<_> = file.split('/').collect();
    (2..=4).contains(&parts.len())
        && parts[0] == "chats"
        && parts.iter().all(|part| {
            !part.is_empty()
                && !matches!(*part, "." | "..")
                && !part.eq_ignore_ascii_case(".git")
                && !part
                    .chars()
                    .any(|c| c.is_control() || matches!(c, '\\' | ':'))
        })
        && parts.last().is_some_and(|name| {
            name.strip_suffix(".json.enc")
                .or_else(|| name.strip_suffix(".json"))
                .is_some_and(|id| !id.is_empty())
        })
}

fn check_local_path(repo: &Path, file: &str) -> Result<(), String> {
    if !allowed_path(file) {
        return Err(format!("Path outside the Git sync chat boundary: {file}"));
    }
    let parts: Vec<_> = file.split('/').collect();
    let mut path = repo.to_path_buf();
    for (index, part) in parts.iter().enumerate() {
        path.push(part);
        match std::fs::symlink_metadata(&path) {
            Ok(meta) => {
                let last = index == parts.len() - 1;
                if meta.file_type().is_symlink()
                    || (!last && !meta.is_dir())
                    || (last && !meta.is_file())
                {
                    return Err(format!("Unsafe Git sync file type: {file}"));
                }
                #[cfg(unix)]
                if last {
                    use std::os::unix::fs::MetadataExt;
                    if meta.nlink() > 1 {
                        return Err(format!("Git sync refuses hard-linked chat files: {file}"));
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => break,
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

fn nul_paths(output: &str) -> Result<Vec<&str>, String> {
    output
        .split('\0')
        .filter(|s| !s.is_empty())
        .map(|s| {
            if s.contains('\u{fffd}') {
                Err("Git sync requires UTF-8 paths".to_string())
            } else {
                Ok(s)
            }
        })
        .collect()
}

fn git(repo: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .arg("--literal-pathspecs")
        .args(args)
        .current_dir(repo)
        .env("GIT_EDITOR", "true") // prevent editor prompts in programmatic usage
        .output()
        .map_err(|e| format!("git {}: {}", args[0], e))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Ensure `repo_dir` is a git repo with the given remote URL.
/// Creates the repo and writes a .gitignore on first call.
pub fn ensure_repo(repo_dir: &Path, remote_url: &str) -> Result<(), String> {
    if std::fs::symlink_metadata(repo_dir)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("Git sync data directory must not be a symlink".to_string());
    }
    if let Ok(meta) = std::fs::symlink_metadata(repo_dir.join(".git")) {
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err("Git sync requires its own local .git directory".to_string());
        }
    }
    if !repo_dir.join(".git").exists() {
        git(repo_dir, &["init", "--initial-branch=main"])?;
        write_gitignore(repo_dir)?;
    }

    // Set or update the remote
    let remotes = git(repo_dir, &["remote"])?;
    if remotes.lines().any(|remote| remote == "origin") {
        git(repo_dir, &["remote", "set-url", "origin", remote_url])?;
    } else {
        git(repo_dir, &["remote", "add", "origin", remote_url])?;
    }
    Ok(())
}

fn write_gitignore(repo_dir: &Path) -> Result<(), String> {
    use std::io::Write;

    let path = repo_dir.join(".gitignore");
    let content =
        "# Only chat exports are eligible for Git sync; enforced in the service.\n/*\n!/chats/\n";
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
    {
        Ok(mut file) => file
            .write_all(content.as_bytes())
            .map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err("Git sync refuses a linked or non-regular .gitignore".into());
            }
            // Preserve existing local ignore rules; the staging boundary is enforced separately.
            Ok(())
        }
        Err(e) => Err(e.to_string()),
    }
}

/// Commit any pending changes.  Returns true if a new commit was made.
fn commit_if_dirty(repo_dir: &Path) -> Result<bool, String> {
    // Prune the index as well as constraining new staging: ignore rules cannot
    // protect secrets already tracked by earlier versions. Never delete them.
    let tracked = git(repo_dir, &["ls-files", "-z"])?;
    let excluded: Vec<_> = nul_paths(&tracked)?
        .into_iter()
        .filter(|file| !allowed_path(file))
        .collect();
    for batch in excluded.chunks(128) {
        let mut args = vec!["rm", "--cached", "-f", "--"];
        args.extend_from_slice(batch);
        git(repo_dir, &args)?;
    }
    let candidates = git(
        repo_dir,
        &[
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
            "--",
            "chats",
        ],
    )?;
    let allowed: Vec<_> = nul_paths(&candidates)?
        .into_iter()
        .filter(|file| allowed_path(file))
        .collect();
    for file in &allowed {
        check_local_path(repo_dir, file)?;
    }
    for batch in allowed.chunks(128) {
        let mut args = vec!["add", "-A", "--"];
        args.extend_from_slice(batch);
        git(repo_dir, &args)?;
    }
    validate_tree(repo_dir, git(repo_dir, &["write-tree"])?.trim())?;
    let status = git(repo_dir, &["diff", "--cached", "--name-only", "-z"])?;
    if status.is_empty() {
        return Ok(false);
    }
    let ts = chrono::Utc::now().to_rfc3339();
    git(repo_dir, &["commit", "-m", &format!("sync: {}", ts)])?;
    Ok(true)
}

fn validate_tree(repo: &Path, revision: &str) -> Result<(), String> {
    let tree = git(repo, &["ls-tree", "-r", "-z", revision])?;
    for entry in nul_paths(&tree)? {
        let (metadata, file) = entry.split_once('\t').ok_or("Invalid Git tree entry")?;
        if !allowed_path(file)
            || !(metadata.starts_with("100644 blob ") || metadata.starts_with("100755 blob "))
        {
            return Err(format!(
                "Git sync refused an unsafe tree entry: {file}. {HISTORY_WARNING}"
            ));
        }
        check_local_path(repo, file)?;
    }
    Ok(())
}

fn validate_rebase_range(repo: &Path, range: &str) -> Result<(), String> {
    let commits = git(repo, &["rev-list", range])?;
    for commit in commits.lines() {
        validate_tree(repo, commit)?;
    }
    Ok(())
}

fn check_idle(repo: &Path) -> Result<(), String> {
    for path in [repo.to_path_buf(), repo.join(".git")] {
        let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("Git sync requires a local data directory and .git directory".into());
        }
    }
    if [
        "rebase-merge",
        "rebase-apply",
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
    ]
    .iter()
    .any(|name| repo.join(".git").join(name).exists())
    {
        return Err("Finish or abort the existing Git operation before syncing".to_string());
    }
    Ok(())
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
    let _lock = match SYNC_LOCK.try_lock() {
        Ok(lock) => lock,
        Err(_) => {
            result.error = Some("A Git sync is already running".to_string());
            return result;
        }
    };
    if let Err(e) = check_idle(repo_dir) {
        result.error = Some(e);
        return result;
    }

    // Commit local changes first
    if let Err(e) = commit_if_dirty(repo_dir) {
        result.error = Some(e);
        return result;
    }

    // Fetch without writing app data. Validate every commit which rebase could
    // check out, including intermediate local commits, before allowing writes.
    let remote_exists = match git(
        repo_dir,
        &["ls-remote", "--heads", "origin", "refs/heads/main"],
    ) {
        Ok(refs) => !refs.trim().is_empty(),
        Err(e) => {
            result.error = Some(e);
            return result;
        }
    };
    if remote_exists {
        let preparation = (|| {
            git(repo_dir, &["fetch", "--no-tags", "origin", "main"])?;
            validate_tree(repo_dir, "FETCH_HEAD")?;
            validate_rebase_range(repo_dir, "HEAD..FETCH_HEAD")?;
            validate_rebase_range(repo_dir, "FETCH_HEAD..HEAD")?;
            Ok::<(), String>(())
        })();
        if let Err(e) = preparation {
            result.error = Some(e);
            return result;
        }
    } else if let Err(e) = validate_rebase_range(repo_dir, "HEAD") {
        // An empty/new remote would receive every ancestor, not only the pruned
        // current tree. Never publish legacy secret history to a fresh remote.
        result.error = Some(e);
        return result;
    }

    match if remote_exists {
        git(repo_dir, &["rebase", "FETCH_HEAD"])
    } else {
        Ok(String::new())
    } {
        Ok(_) => result.pulled = remote_exists,
        Err(e) => {
            if e.contains("CONFLICT") || e.contains("conflict") {
                // Auto-resolve: pick the version with the newer updated_at for each file
                match auto_resolve_rebase(repo_dir) {
                    Ok(_) => result.pulled = true,
                    Err(resolve_err) => {
                        let abort_error = git(repo_dir, &["rebase", "--abort"]).err();
                        result.conflict = true;
                        result.error = Some(match abort_error {
                            Some(e) => format!("{resolve_err}; could not abort rebase: {e}"),
                            None => resolve_err,
                        });
                        return result;
                    }
                }
            } else {
                result.error = Some(e);
                return result;
            }
        }
    }

    if let Err(e) = validate_tree(repo_dir, "HEAD") {
        result.error = Some(e);
        return result;
    }
    // Push only the HEAD we validated, never a different local main branch.
    match git(repo_dir, &["push", "-u", "origin", "HEAD:main"]) {
        Ok(_) => result.pushed = true,
        Err(e) => result.error = Some(e),
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
        let conflicted = git(repo_dir, &["diff", "--name-only", "--diff-filter=U", "-z"])?;

        if conflicted.trim().is_empty() {
            // No conflicts right now — check if the rebase is still in progress
            if repo_dir.join(".git/rebase-merge").exists()
                || repo_dir.join(".git/rebase-apply").exists()
            {
                match git(repo_dir, &["rebase", "--continue"]) {
                    Ok(_) => return Ok(()),
                    Err(e) if e.contains("No changes") => {
                        git(repo_dir, &["rebase", "--skip"])?;
                        continue;
                    }
                    Err(e) if e.contains("CONFLICT") || e.contains("conflict") => continue,
                    Err(e) => return Err(e),
                }
            }
            return Ok(());
        }

        for file in nul_paths(&conflicted)? {
            resolve_single_file(repo_dir, file)?;
        }

        // Continue after resolving this round of conflicts
        match git(repo_dir, &["rebase", "--continue"]) {
            Ok(_) => return Ok(()),
            Err(e) if e.contains("No changes") => {
                git(repo_dir, &["rebase", "--skip"])?;
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
    check_local_path(repo_dir, file)?;
    let stages = git(repo_dir, &["ls-files", "--stage", "-z", "--", file])?;
    for entry in nul_paths(&stages)? {
        if !(entry.starts_with("100644 ") || entry.starts_with("100755 ")) {
            return Err(format!(
                "Git sync refuses non-regular conflict file: {file}"
            ));
        }
    }
    // During rebase: stage 2 = target branch (remote), stage 3 = commit being replayed (local)
    let remote = git(repo_dir, &["show", &format!(":2:{}", file)]).ok();
    let local = git(repo_dir, &["show", &format!(":3:{}", file)]).ok();
    let chosen = pick_newer_version(remote.as_deref(), local.as_deref());

    let file_path = repo_dir.join(file);
    std::fs::write(&file_path, chosen).map_err(|e| format!("write {}: {}", file, e))?;
    git(repo_dir, &["add", "--", file])?;
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

#[cfg(test)]
mod tests {
    use super::*;

    static TEST_SYNC_LOCK: Mutex<()> = Mutex::new(());

    fn repo() -> tempfile::TempDir {
        let dir = tempfile::Builder::new()
            .prefix(".git-sync-test-")
            .tempdir_in(std::env::current_dir().unwrap())
            .unwrap();
        ensure_repo(dir.path(), "unused-test-remote").unwrap();
        git(dir.path(), &["config", "user.name", "Sync Test"]).unwrap();
        git(
            dir.path(),
            &["config", "user.email", "sync@example.invalid"],
        )
        .unwrap();
        git(dir.path(), &["config", "commit.gpgsign", "false"]).unwrap();
        dir
    }

    fn write(repo: &Path, file: &str, content: &str) {
        let path = repo.join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn stages_only_chat_exports_and_preserves_deletions() {
        let dir = repo();
        let root = dir.path();
        let allowed = [
            "chats/legacy.json",
            "chats/Work space/Project [one]/session.json",
            "chats/.Private/encrypted.json.enc",
        ];
        for file in allowed {
            write(root, file, "{}");
        }
        for file in [
            "browser-profiles/provider/Cookies",
            "browser-profiles/provider/session.json",
            "aetherium.db",
            "aetherium.db.keywrap",
            "settings.json",
            "logs/app.log",
            "id_ed25519",
            "secrets/key",
            "chats/session.json.tmp",
            "chats/private.key",
            "vector_index/index",
        ] {
            write(root, file, "synthetic-secret");
        }
        assert!(commit_if_dirty(root).unwrap());
        let tracked = git(root, &["ls-files", "-z"]).unwrap();
        let paths = nul_paths(&tracked).unwrap();
        assert_eq!(paths.len(), allowed.len());
        assert!(allowed.iter().all(|file| paths.contains(file)));
        assert!(!commit_if_dirty(root).unwrap());
        std::fs::remove_file(root.join(allowed[0])).unwrap();
        assert!(commit_if_dirty(root).unwrap());
        assert!(!git(root, &["ls-files", "-z"]).unwrap().contains(allowed[0]));
    }

    #[test]
    fn removes_previously_tracked_and_staged_secrets_without_deleting_files_or_history() {
        let dir = repo();
        let root = dir.path();
        let tracked_secret = "browser-profiles/provider/Cookies";
        write(root, tracked_secret, "synthetic-cookie");
        git(root, &["add", "-f", "--", tracked_secret]).unwrap();
        git(root, &["commit", "-m", "synthetic legacy sync"]).unwrap();
        let old_head = git(root, &["rev-parse", "HEAD"]).unwrap();
        write(root, "aetherium.db.keywrap", "synthetic-keywrap");
        git(root, &["add", "-f", "--", "aetherium.db.keywrap"]).unwrap();
        write(root, "chats/session.json", "{}");
        assert!(commit_if_dirty(root).unwrap());
        assert_eq!(
            git(root, &["ls-files", "-z"]).unwrap(),
            "chats/session.json\0"
        );
        assert_eq!(
            std::fs::read_to_string(root.join(tracked_secret)).unwrap(),
            "synthetic-cookie"
        );
        assert!(root.join("aetherium.db.keywrap").exists());
        assert_eq!(
            git(
                root,
                &["show", &format!("{}:{tracked_secret}", old_head.trim())]
            )
            .unwrap(),
            "synthetic-cookie"
        );
        assert!(HISTORY_WARNING.contains("does not remove history"));
    }

    #[test]
    fn refuses_excluded_incoming_trees_and_intermediate_rebase_commits() {
        let dir = repo();
        let root = dir.path();
        write(root, "chats/session.json", "{}");
        commit_if_dirty(root).unwrap();
        let base = git(root, &["rev-parse", "HEAD"]).unwrap();
        write(root, "browser-profiles/provider/session.json", "synthetic");
        git(
            root,
            &["add", "-f", "--", "browser-profiles/provider/session.json"],
        )
        .unwrap();
        git(root, &["commit", "-m", "synthetic unsafe incoming commit"]).unwrap();
        assert!(validate_tree(root, "HEAD").is_err());
        commit_if_dirty(root).unwrap();
        assert!(validate_tree(root, "HEAD").is_ok());
        assert!(validate_rebase_range(root, &format!("{}..HEAD", base.trim())).is_err());
        assert!(root.join("browser-profiles/provider/session.json").exists());
    }

    #[test]
    fn refuses_conflict_paths_outside_the_boundary_and_interrupted_operations() {
        let _lock = TEST_SYNC_LOCK.lock().unwrap();
        let dir = repo();
        let root = dir.path();
        write(root, "browser-profiles/provider/Cookies", "unchanged");
        for file in [
            "browser-profiles/provider/Cookies",
            "../escape.json",
            "chats/../key.json",
        ] {
            assert!(resolve_single_file(root, file).is_err());
        }
        assert_eq!(
            std::fs::read_to_string(root.join("browser-profiles/provider/Cookies")).unwrap(),
            "unchanged"
        );
        std::fs::create_dir(root.join(".git/rebase-merge")).unwrap();
        assert!(sync(root).error.unwrap().contains("existing Git operation"));
    }

    #[test]
    fn resolves_chat_rebase_conflicts_using_newer_timestamp() {
        let dir = repo();
        let root = dir.path();
        let file = "chats/Work space/Project [one]/session.json";
        write(
            root,
            file,
            r#"{"updated_at":"2025-01-01","message":"base"}"#,
        );
        commit_if_dirty(root).unwrap();
        git(root, &["checkout", "-b", "incoming"]).unwrap();
        write(
            root,
            file,
            r#"{"updated_at":"2025-03-01","message":"remote"}"#,
        );
        commit_if_dirty(root).unwrap();
        git(root, &["checkout", "main"]).unwrap();
        write(
            root,
            file,
            r#"{"updated_at":"2025-02-01","message":"local"}"#,
        );
        commit_if_dirty(root).unwrap();
        assert!(git(root, &["rebase", "incoming"]).is_err());
        auto_resolve_rebase(root).unwrap();
        assert!(std::fs::read_to_string(root.join(file))
            .unwrap()
            .contains("remote"));
        validate_tree(root, "HEAD").unwrap();
        check_idle(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_linked_chat_sources_and_conflict_destinations() {
        use std::os::unix::fs::symlink;
        let dir = repo();
        let root = dir.path();
        write(root, "secrets/key", "synthetic-key");
        std::fs::create_dir(root.join("chats")).unwrap();
        symlink("../secrets/key", root.join("chats/session.json")).unwrap();
        assert!(commit_if_dirty(root).is_err());
        assert!(resolve_single_file(root, "chats/session.json").is_err());
        std::fs::remove_file(root.join("chats/session.json")).unwrap();
        std::fs::hard_link(root.join("secrets/key"), root.join("chats/session.json")).unwrap();
        assert!(commit_if_dirty(root).is_err());
        assert!(resolve_single_file(root, "chats/session.json").is_err());
        std::fs::remove_file(root.join("chats/session.json")).unwrap();
        symlink("../secrets", root.join("chats/linked")).unwrap();
        assert!(check_local_path(root, "chats/linked/session.json").is_err());
        assert_eq!(
            std::fs::read_to_string(root.join("secrets/key")).unwrap(),
            "synthetic-key"
        );
    }

    #[test]
    fn validates_portable_chat_paths_and_encrypted_conflict_fallback() {
        for file in [
            "chats/.json",
            "chats/.json.enc",
            "chats/a/../../secrets.json",
            "chats/a\\..\\secrets.json",
            "chats/a:stream.json",
            "chats/a\nb.json",
            "chats/.git/config.json",
            "chats/a/b/c/nested.json",
            "browser-profiles/session.json.enc",
        ] {
            assert!(!allowed_path(file), "{file}");
        }
        assert_eq!(
            pick_newer_version(
                Some(r#"{"encrypted":true,"ciphertext":"remote"}"#),
                Some(r#"{"encrypted":true,"ciphertext":"local"}"#)
            ),
            r#"{"encrypted":true,"ciphertext":"local"}"#
        );
    }

    #[cfg(unix)]
    #[test]
    fn refuses_incoming_symlink_tree_even_when_destination_is_missing() {
        use std::os::unix::fs::symlink;
        let dir = repo();
        let root = dir.path();
        std::fs::create_dir(root.join("chats")).unwrap();
        symlink("../secrets/key", root.join("chats/session.json")).unwrap();
        git(root, &["add", "--", "chats/session.json"]).unwrap();
        let tree = git(root, &["write-tree"]).unwrap();
        std::fs::remove_file(root.join("chats/session.json")).unwrap();
        assert!(validate_tree(root, tree.trim()).is_err());
    }

    #[test]
    fn refuses_legacy_secret_history_before_first_push_to_empty_remote() {
        let _lock = TEST_SYNC_LOCK.lock().unwrap();
        let dir = repo();
        let root = dir.path();
        let remote = repo();
        git(
            root,
            &[
                "remote",
                "set-url",
                "origin",
                remote.path().to_str().unwrap(),
            ],
        )
        .unwrap();
        write(
            root,
            "browser-profiles/provider/Cookies",
            "synthetic-cookie",
        );
        git(
            root,
            &["add", "-f", "--", "browser-profiles/provider/Cookies"],
        )
        .unwrap();
        git(root, &["commit", "-m", "synthetic legacy secret"]).unwrap();
        let original = git(root, &["rev-parse", "HEAD"]).unwrap();
        write(root, "chats/session.json", "{}");

        let result = sync(root);

        assert!(!result.pushed);
        assert!(result.error.unwrap().contains(HISTORY_WARNING));
        validate_tree(root, "HEAD").unwrap();
        assert!(git(root, &["rev-list", "HEAD"])
            .unwrap()
            .lines()
            .any(|commit| commit == original.trim()));
        assert!(git(remote.path(), &["show-ref", "--heads"]).is_err());
        assert_eq!(
            std::fs::read_to_string(root.join("browser-profiles/provider/Cookies")).unwrap(),
            "synthetic-cookie"
        );
    }

    #[cfg(unix)]
    #[test]
    fn initial_ignore_creation_refuses_symlink_without_overwriting_target() {
        use std::os::unix::fs::symlink;
        let dir = repo();
        let root = dir.path();
        write(root, "secrets/key", "synthetic-key");
        std::fs::remove_file(root.join(".gitignore")).unwrap();
        symlink("secrets/key", root.join(".gitignore")).unwrap();
        assert!(write_gitignore(root).is_err());
        assert_eq!(
            std::fs::read_to_string(root.join("secrets/key")).unwrap(),
            "synthetic-key"
        );
    }
}
