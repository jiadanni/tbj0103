use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use crate::db::DbState;

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

    // Resolve script path from bundled resources
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot locate app resource dir: {e}"))?;
    let script_path = resource_dir.join("playwright-runner.js");
    if !script_path.exists() {
        return Err(format!(
            "playwright-runner.js not found at {}",
            script_path.display()
        ));
    }

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

    while let Some(line) = reader.next_line().await.map_err(|e| e.to_string())? {
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
                let msg = parsed.message.unwrap_or_else(|| "Unknown error from playwright-runner".to_string());
                return Err(msg);
            }
            _ => {}
        }
    }

    // Wait for the child to exit; ignore its exit code — errors are surfaced
    // through the event stream above.
    let _ = child.wait().await;

    Ok(String::new())
}
