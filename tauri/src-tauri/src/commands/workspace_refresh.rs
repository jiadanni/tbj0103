/// Workspace knowledge refresh coordinator.
///
/// Replaces the legacy `analyze_workspace_chunked` single-shot LLM call (which
/// asks one model to emit a deeply nested chapters → sections → concepts JSON
/// document) with a fan-out across the seven persistent background jobs that
/// already produce the same shapes incrementally:
///
/// - `memory_extraction`
/// - `workspace_glossary`
/// - `hover_definition_scan`
/// - `summarization`
/// - `flashcard_generation`
/// - `concept_hierarchy`
/// - `workspace_prompt_bank`
///
/// Per-job failure surfaces per-job. Small models that previously couldn't
/// emit schema-strict nested JSON still produce usable output on the
/// individual jobs (each of which has its own bounded, simpler prompt).
use crate::services::background_scheduler;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::AppHandle;

/// Task types the coordinator drives. Order matters only for the enqueue
/// log; the scheduler serializes jobs via its global semaphore.
const REFRESH_TASK_TYPES: &[&str] = &[
    "memory_extraction",
    "workspace_glossary",
    "hover_definition_scan",
    "summarization",
    "flashcard_generation",
    "concept_hierarchy",
    "workspace_prompt_bank",
];

/// Per-job timeout for sync mode. Jobs are serialized, so the total wait can
/// be up to roughly `PER_JOB_TIMEOUT_SECS * REFRESH_TASK_TYPES.len()`. Five
/// minutes per job covers heavy summarization on slow hardware without
/// allowing a silently-stuck job to wedge the coordinator forever.
const PER_JOB_TIMEOUT_SECS: u64 = 300;

#[derive(Debug, Clone, Serialize)]
pub struct EnqueueFailure {
    pub task_type: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RefreshWorkspaceResult {
    pub enqueued: Vec<String>,
    pub failed_to_enqueue: Vec<EnqueueFailure>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RefreshWorkspaceRequest {
    pub workspace_id: String,
    /// "async" (default — return after enqueue) or "sync" (wait for all
    /// enqueued jobs to reach a terminal status).
    pub mode: String,
    /// Optional subset of [`REFRESH_TASK_TYPES`] to run. Empty (the default)
    /// runs all seven — the full workspace refresh used by Data Controls.
    /// The Knowledge Graph view passes only the graph-feeding jobs.
    #[serde(default)]
    pub task_types: Vec<String>,
}

#[tauri::command]
pub async fn refresh_workspace_knowledge(
    app: AppHandle,
    req: RefreshWorkspaceRequest,
) -> Result<RefreshWorkspaceResult, String> {
    if req.workspace_id.trim().is_empty() {
        return Err("workspace_id is required".to_string());
    }
    let sync_mode = matches!(req.mode.as_str(), "sync");

    let selected: Vec<&'static str> = if req.task_types.is_empty() {
        REFRESH_TASK_TYPES.to_vec()
    } else {
        let mut subset = Vec::new();
        for requested in &req.task_types {
            match REFRESH_TASK_TYPES.iter().find(|known| *known == requested) {
                Some(known) => {
                    if !subset.contains(known) {
                        subset.push(*known);
                    }
                }
                None => return Err(format!("Unknown refresh task type: {requested}")),
            }
        }
        subset
    };

    // Subscribe BEFORE enqueue so we cannot miss a fast job's completion.
    // The scheduler also writes every event to its in-process broadcast bus
    // immediately on emit.
    let mut event_rx = if sync_mode {
        Some(background_scheduler::subscribe_task_events())
    } else {
        None
    };

    let pending: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(
        selected.iter().map(|s| s.to_string()).collect(),
    ));

    let mut enqueued = Vec::new();
    let mut failed_to_enqueue = Vec::new();
    for task_type in &selected {
        match background_scheduler::queue_manual_job(app.clone(), task_type.to_string()) {
            Ok(()) => enqueued.push((*task_type).to_string()),
            Err(error) => {
                // Failed-to-enqueue jobs will never emit terminal events; drop
                // them from the pending set so sync mode doesn't block on them.
                if let Ok(mut set) = pending.lock() {
                    set.remove(*task_type);
                }
                failed_to_enqueue.push(EnqueueFailure {
                    task_type: (*task_type).to_string(),
                    error,
                });
            }
        }
    }

    if !sync_mode {
        return Ok(RefreshWorkspaceResult {
            enqueued,
            failed_to_enqueue,
        });
    }

    // Sync: drain terminal events until pending is empty or a per-job
    // timeout elapses with no progress.
    let Some(rx) = event_rx.as_mut() else {
        return Ok(RefreshWorkspaceResult {
            enqueued,
            failed_to_enqueue,
        });
    };
    let deadline_per_job = Duration::from_secs(PER_JOB_TIMEOUT_SECS);
    loop {
        let still_pending = pending.lock().map(|s| s.len()).unwrap_or(0);
        if still_pending == 0 {
            break;
        }
        match tokio::time::timeout(deadline_per_job, rx.recv()).await {
            Ok(Ok(event)) => {
                let terminal =
                    matches!(event.status.as_str(), "completed" | "failed" | "cancelled");
                if !terminal {
                    continue;
                }
                if !selected.contains(&event.task_type.as_str()) {
                    continue;
                }
                if let Ok(mut set) = pending.lock() {
                    set.remove(&event.task_type);
                }
            }
            Ok(Err(_)) => {
                // Channel closed or we lagged so badly the bus dropped us.
                // Either way, stop waiting.
                break;
            }
            Err(_) => {
                // No event for the per-job timeout window — give up rather
                // than block IPC indefinitely.
                break;
            }
        }
    }

    Ok(RefreshWorkspaceResult {
        enqueued,
        failed_to_enqueue,
    })
}
