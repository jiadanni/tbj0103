/// AI-powered knowledge graph analysis commands.
/// analyze_workspace — infers concepts & relationships from workspace content via Ollama.
///
/// These are thin Tauri command wrappers; the actual analysis, chunking,
/// and dedup logic lives in `services::knowledge_analysis`.
use crate::db::DbState;
use crate::services::knowledge_analysis::{
    analyze_workspace_chunked_impl, gather_workspace_items, run_semantic_dedup_pass,
    AnalysisResult, AnalyzeWorkspaceRequest,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Serialize)]
pub struct WorkspaceAnalyzableResult {
    pub ready: bool,
    pub item_count: usize,
    pub char_count: usize,
}

#[tauri::command]
pub async fn check_workspace_analyzable(
    state: State<'_, DbState>,
    workspace_id: String,
) -> Result<WorkspaceAnalyzableResult, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let items = gather_workspace_items(&conn, &workspace_id);
    let total_chars: usize = items.iter().map(|i| i.text.len()).sum();
    let total_items = items.len();
    let ready = total_items >= 6 && total_chars >= 1200;
    Ok(WorkspaceAnalyzableResult {
        ready,
        item_count: total_items,
        char_count: total_chars,
    })
}

#[tauri::command]
pub async fn analyze_workspace(
    app: AppHandle,
    state: State<'_, DbState>,
    req: AnalyzeWorkspaceRequest,
) -> Result<AnalysisResult, String> {
    // deprecated: superseded by `refresh_workspace_knowledge` (the
    // background-job coordinator). Kept callable while the new flow soaks;
    // remove together with `analyze_workspace_chunked` once the UI no longer
    // exposes a one-shot LLM hierarchy path.
    // Legacy thunk: single chunk with budget=22_000
    analyze_workspace_chunked_impl(&app, &state.0, req, Some(22_000)).await
}

#[tauri::command]
pub async fn analyze_workspace_chunked(
    app: AppHandle,
    state: State<'_, DbState>,
    req: AnalyzeWorkspaceRequest,
) -> Result<AnalysisResult, String> {
    // deprecated: superseded by `refresh_workspace_knowledge` (the
    // background-job coordinator). The JSON-salvage repair in
    // `analyze_chunk` exists to keep this path working on small models that
    // can't emit schema-strict nested JSON; remove that salvage code together
    // with this command in the follow-up cleanup.
    // Adaptive budget
    analyze_workspace_chunked_impl(&app, &state.0, req, None).await
}

#[derive(Debug, Clone, Serialize)]
pub struct DedupReport {
    pub merged_chapters: usize,
    pub merged_sections: usize,
    pub proposals_created: usize,
}

#[derive(Debug, Deserialize)]
pub struct DedupWorkspaceRequest {
    pub workspace_id: String,
    pub model: String,
    pub ollama_url: Option<String>,
}

#[tauri::command]
pub async fn dedup_workspace_concepts(
    state: State<'_, DbState>,
    req: DedupWorkspaceRequest,
) -> Result<DedupReport, String> {
    let pool = state.0.clone();

    let supersede_mode = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let raw = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'knowledge.supersede_mode'",
                [],
                |r| r.get::<_, String>(0),
            )
            .unwrap_or_else(|_| "\"auto\"".to_string());
        serde_json::from_str::<String>(&raw).unwrap_or_else(|_| "auto".to_string())
    };

    let job_id = format!("dedup-{}", uuid::Uuid::new_v4());

    let (mc, pc1) = run_semantic_dedup_pass(
        &pool,
        &req.workspace_id,
        "chapter",
        &req.model,
        req.ollama_url.as_deref(),
        &job_id,
        &supersede_mode,
    )
    .await?;
    let (ms, pc2) = run_semantic_dedup_pass(
        &pool,
        &req.workspace_id,
        "section",
        &req.model,
        req.ollama_url.as_deref(),
        &job_id,
        &supersede_mode,
    )
    .await?;

    Ok(DedupReport {
        merged_chapters: mc,
        merged_sections: ms,
        proposals_created: pc1 + pc2,
    })
}

#[derive(Debug, Deserialize)]
pub struct AnalyzeDescendantsRequest {
    pub workspace_id: String,
    pub model: String,
    pub ollama_url: Option<String>,
    pub focus_topic: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DescendantAnalysisProgress {
    pub workspace_id: String,
    pub workspace_name: String,
    pub index: usize,
    pub total: usize,
    pub status: String, // "started" | "completed" | "skipped" | "failed"
    pub error: Option<String>,
    pub result: Option<AnalysisResult>,
}

#[tauri::command]
pub async fn analyze_descendants(
    app: AppHandle,
    state: State<'_, DbState>,
    req: AnalyzeDescendantsRequest,
) -> Result<Vec<DescendantAnalysisProgress>, String> {
    use crate::commands::ollama::BackgroundInferenceCancel;

    // Get direct child workspaces
    let children: Vec<(String, String)> = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, name FROM workspaces WHERE parent_workspace_id = ?1 ORDER BY order_index, name",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![req.workspace_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    if children.is_empty() {
        return Err("No child workspaces found to analyze.".to_string());
    }

    let total = children.len();
    let mut results: Vec<DescendantAnalysisProgress> = Vec::with_capacity(total);

    // Subscribe to cancellation — yield if user starts chatting
    let cancel_rx = app.state::<BackgroundInferenceCancel>().0.subscribe();

    for (index, (ws_id, ws_name)) in children.iter().enumerate() {
        // Check cancellation before each child
        if cancel_rx.has_changed().unwrap_or(false) {
            // User started chatting — stop analysis
            let progress = DescendantAnalysisProgress {
                workspace_id: ws_id.clone(),
                workspace_name: ws_name.clone(),
                index,
                total,
                status: "skipped".to_string(),
                error: Some("Yielded to active chat".to_string()),
                result: None,
            };
            let _ = app.emit("descendant-analysis-progress", &progress);
            results.push(progress);
            break;
        }

        // Emit started
        let started = DescendantAnalysisProgress {
            workspace_id: ws_id.clone(),
            workspace_name: ws_name.clone(),
            index,
            total,
            status: "started".to_string(),
            error: None,
            result: None,
        };
        let _ = app.emit("descendant-analysis-progress", &started);

        // Run analysis for this child
        let child_req = AnalyzeWorkspaceRequest {
            workspace_id: ws_id.clone(),
            model: req.model.clone(),
            ollama_url: req.ollama_url.clone(),
            focus_topic: req.focus_topic.clone(),
            survey_context: None,
        };

        match analyze_workspace_chunked_impl(&app, &state.0, child_req, Some(22_000)).await {
            Ok(result) => {
                let progress = DescendantAnalysisProgress {
                    workspace_id: ws_id.clone(),
                    workspace_name: ws_name.clone(),
                    index,
                    total,
                    status: "completed".to_string(),
                    error: None,
                    result: Some(result),
                };
                let _ = app.emit("descendant-analysis-progress", &progress);
                results.push(progress);
            }
            Err(err) => {
                let progress = DescendantAnalysisProgress {
                    workspace_id: ws_id.clone(),
                    workspace_name: ws_name.clone(),
                    index,
                    total,
                    status: if err.contains("No content found")
                        || err.contains("Not enough workspace material")
                    {
                        "skipped".to_string()
                    } else {
                        "failed".to_string()
                    },
                    error: Some(err),
                    result: None,
                };
                let _ = app.emit("descendant-analysis-progress", &progress);
                results.push(progress);
            }
        }
    }

    Ok(results)
}
