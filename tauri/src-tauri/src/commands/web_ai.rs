use crate::db::DbState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::oneshot;

pub struct WebStreamCancelState(pub Mutex<HashMap<String, oneshot::Sender<()>>>);

#[derive(Debug, Serialize, Deserialize, Clone)]
struct StreamEvent {
    session_id: String,
    chunk: String,
    done: bool,
    tokens_used: Option<u32>,
    duration_ms: Option<u64>,
}

/// A JSON-line emitted by playwright-runner.js on stdout.
#[derive(Debug, Deserialize)]
struct RunnerLine {
    #[serde(rename = "type")]
    line_type: String,
    text: Option<String>,
    message: Option<String>,
}

fn resolve_playwright_runner_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut checked_paths = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled_path = resource_dir.join("playwright-runner.js");
        if bundled_path.exists() {
            return Ok(bundled_path);
        }
        checked_paths.push(bundled_path);
    }

    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("playwright-runner.js");
    if dev_path.exists() {
        return Ok(dev_path);
    }
    checked_paths.push(dev_path);

    let checked_paths = checked_paths
        .into_iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");

    Err(format!(
        "playwright-runner.js not found. Checked: {checked_paths}"
    ))
}

/// Send a query to a web AI provider via Playwright.
///
/// The Playwright Node.js script (`resources/playwright-runner.js`) is spawned
/// with `node`. It opens a visible Chromium window, waits for the user to log in,
/// submits the query, and streams back JSON-lines on stdout that are forwarded
/// as Tauri events using the same `ollama-stream-{session_id}` event name that
/// the frontend already listens to.
///
/// `preserve_session`: when false (the default), the browser profile is wiped
/// after the query completes so no credentials remain on disk.
#[tauri::command]
pub async fn send_web_message(
    app: AppHandle,
    _state: State<'_, DbState>,
    cancel_state: State<'_, WebStreamCancelState>,
    session_id: String,
    provider: String,
    query: String,
    preserve_session: bool,
) -> Result<String, String> {
    // Validate provider name to prevent shell injection
    let valid_providers = ["chatgpt", "deepseek", "claude", "gemini"];
    if !valid_providers.contains(&provider.as_str()) {
        return Err(format!(
            "Unsupported provider '{}'. Supported: {}",
            provider,
            valid_providers.join(", ")
        ));
    }

    // Prefer bundled resources, but fall back to the checked-in file in dev.
    let script_path = resolve_playwright_runner_path(&app)?;

    // Resolve per-provider profile directory inside app data dir
    let profile_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot locate app data dir: {e}"))?
        .join("browser-profiles")
        .join(&provider);

    // Build the node command — no shell interpolation; each argument is a
    // separate entry so there is no injection surface.
    let mut cmd = Command::new("node");
    cmd.arg(&script_path)
        .arg("--provider")
        .arg(&provider)
        .arg("--query")
        .arg(&query)
        .arg("--profile-dir")
        .arg(&profile_dir);

    if preserve_session {
        cmd.arg("--preserve");
    }

    cmd.stdout(Stdio::piped()).stderr(Stdio::null());

    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Node.js not found on PATH — please install Node.js (https://nodejs.org) \
             and ensure `node` is accessible."
                .to_string()
        } else {
            format!("Failed to start playwright-runner: {e}")
        }
    })?;

    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to capture playwright-runner stdout")?;

    let mut reader = BufReader::new(stdout).lines();
    let event_name = format!("ollama-stream-{session_id}");
    let (cancel_tx, mut cancel_rx) = oneshot::channel();
    {
        let mut cancel_map = cancel_state.0.lock().map_err(|e| e.to_string())?;
        if let Some(previous) = cancel_map.insert(session_id.clone(), cancel_tx) {
            let _ = previous.send(());
        }
    }

    let mut cancelled = false;

    loop {
        let line = tokio::select! {
            _ = &mut cancel_rx => {
                cancelled = true;
                break;
            }
            line = reader.next_line() => line.map_err(|e| e.to_string())?,
        };

        let Some(line) = line else {
            break;
        };

        if line.trim().is_empty() {
            continue;
        }

        let parsed: RunnerLine = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        match parsed.line_type.as_str() {
            "chunk" => {
                let text = parsed.text.unwrap_or_default();
                if text.is_empty() {
                    continue;
                }
                let event = StreamEvent {
                    session_id: session_id.clone(),
                    chunk: text,
                    done: false,
                    tokens_used: None,
                    duration_ms: None,
                };
                app.emit(&event_name, &event)
                    .map_err(|e| format!("Tauri emit error: {e}"))?;
            }
            "done" => {
                let event = StreamEvent {
                    session_id: session_id.clone(),
                    chunk: String::new(),
                    done: true,
                    tokens_used: None,
                    duration_ms: None,
                };
                app.emit(&event_name, &event)
                    .map_err(|e| format!("Tauri emit error: {e}"))?;
                break;
            }
            "error" => {
                let msg = parsed
                    .message
                    .unwrap_or_else(|| "Unknown error from playwright-runner".to_string());
                return Err(msg);
            }
            _ => {}
        }
    }

    {
        let mut cancel_map = cancel_state.0.lock().map_err(|e| e.to_string())?;
        cancel_map.remove(&session_id);
    }

    if cancelled {
        let _ = child.kill().await;
        let event = StreamEvent {
            session_id: session_id.clone(),
            chunk: String::new(),
            done: true,
            tokens_used: None,
            duration_ms: None,
        };
        let _ = app.emit(&event_name, &event);
    } else {
        // Wait for the child to exit; ignore its exit code — errors are surfaced
        // through the event stream above.
        let _ = child.wait().await;
    }

    Ok(String::new())
}

#[tauri::command]
pub fn stop_web_stream(
    session_id: String,
    cancel_state: State<'_, WebStreamCancelState>,
) -> Result<(), String> {
    let mut cancel_map = cancel_state.0.lock().map_err(|e| e.to_string())?;
    if let Some(cancel_tx) = cancel_map.remove(&session_id) {
        let _ = cancel_tx.send(());
    }
    Ok(())
}
