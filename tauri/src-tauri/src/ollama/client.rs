use crate::commands::ollama::{StreamAbortEntry, StreamAbortState};
/// Ollama HTTP Client
/// Ported from Services/OllamaService.swift
///
/// Connects to a local Ollama instance (default: http://localhost:11434).
/// Supports chat, streaming, embeddings, and model listing.
use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const DEFAULT_BASE_URL: &str = "http://localhost:11434";
const MODEL_CACHE_TTL: Duration = Duration::from_secs(30);
/// Capabilities are fetched via /api/show which is expensive (can take 20-50s
/// on a cold Ollama instance). They almost never change between app restarts
/// (only after `ollama pull`), so cache them per model name for 10 minutes.
const CAPABILITY_CACHE_TTL: Duration = Duration::from_secs(600);

// Process-level cache for /api/tags responses, keyed by base URL.
// This prevents a redundant GET /api/tags before every /api/chat call.
struct CachedModels {
    models: Vec<ModelInfo>,
    fetched_at: Instant,
    url: String,
}

static MODEL_CACHE: OnceLock<Mutex<Option<CachedModels>>> = OnceLock::new();

/// Per-model capabilities cache: (base_url, model_name) -> (capabilities, fetched_at).
/// Keyed by both server URL and model name so that two local Ollama instances
/// exposing the same model name on different ports cannot cross-contaminate each
/// other's capability metadata.
struct CapabilityCache {
    entries: HashMap<CapabilityCacheKey, CapabilityCacheEntry>,
}

type CapabilityCacheKey = (String, String);
type CapabilityCacheEntry = (Option<Vec<String>>, Instant);

static CAPABILITY_CACHE: OnceLock<Mutex<CapabilityCache>> = OnceLock::new();

fn capability_cache() -> &'static Mutex<CapabilityCache> {
    CAPABILITY_CACHE.get_or_init(|| {
        Mutex::new(CapabilityCache {
            entries: HashMap::new(),
        })
    })
}

// Shared HTTP client — reqwest::Client is internally Arc'd and manages a
// connection pool, so reusing one instance across all OllamaClient instances
// avoids redundant TCP/TLS handshakes.
static SHARED_HTTP_CLIENT: OnceLock<Client> = OnceLock::new();

// Streaming requires a different timeout posture: long generations on slower
// hardware can legitimately exceed any fixed body timeout. We give the
// streaming client a generous connect timeout (so unreachable Ollama still
// fails fast) but no overall request timeout, since the per-chunk select
// loop in `stream_with_prefix` already enforces idle/abort handling.
static STREAMING_HTTP_CLIENT: OnceLock<Client> = OnceLock::new();

fn shared_http_client() -> &'static Client {
    SHARED_HTTP_CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .pool_max_idle_per_host(4)
            .build()
            .expect("Failed to build shared HTTP client")
    })
}

fn streaming_http_client() -> &'static Client {
    STREAMING_HTTP_CLIENT.get_or_init(|| {
        Client::builder()
            .connect_timeout(std::time::Duration::from_secs(15))
            .pool_max_idle_per_host(2)
            .build()
            .expect("Failed to build streaming HTTP client")
    })
}

fn model_cache() -> &'static Mutex<Option<CachedModels>> {
    MODEL_CACHE.get_or_init(|| Mutex::new(None))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<OllamaMessage>,
    pub stream: bool,
    pub options: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub model: String,
    pub message: OllamaMessage,
    pub done: bool,
    pub total_duration: Option<i64>,
    pub eval_duration: Option<i64>,
    pub eval_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamChunk {
    pub model: String,
    pub message: OllamaMessage,
    pub done: bool,
    pub eval_count: Option<i64>,
    pub eval_duration: Option<i64>,
    pub total_duration: Option<i64>,
    pub load_duration: Option<i64>,
    pub prompt_eval_duration: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingRequest {
    pub model: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingResponse {
    pub embeddings: Vec<Vec<f32>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDetails {
    pub parameter_size: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub size: Option<i64>,
    pub modified_at: Option<String>,
    pub details: Option<ModelDetails>,
    pub capabilities: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagsResponse {
    pub models: Vec<ModelInfo>,
}

/// Single entry returned by Ollama's `/api/ps` endpoint.
/// Fields mirror Ollama's response shape; missing fields are tolerated.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadedModelInfo {
    pub name: String,
    #[serde(default)]
    pub size: Option<i64>,
    #[serde(default)]
    pub size_vram: Option<i64>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub digest: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LoadedModelsResponse {
    #[serde(default)]
    pub models: Vec<LoadedModelInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ShowModelRequest {
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ShowModelResponse {
    pub capabilities: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEvent {
    pub session_id: String,
    pub chunk: String,
    pub done: bool,
    pub tokens_used: Option<i64>,
    pub duration_ms: Option<i64>,
    pub load_duration_ms: Option<i64>,
}

#[derive(Debug, Clone, Default)]
pub struct RequestContext {
    pub request_id: Option<String>,
    pub source: Option<&'static str>,
    pub session_id: Option<String>,
    pub model: Option<String>,
    pub stream: Option<bool>,
    /// If set, overrides the shared client's default 300s timeout for this
    /// request. Use a short value (e.g. 90s) for background / non-interactive
    /// calls so they fail fast instead of blocking the Ollama queue.
    pub timeout_override: Option<Duration>,
}

pub struct OllamaClient {
    client: Client,
    pub base_url: String,
}

impl Clone for OllamaClient {
    // reqwest::Client is internally Arc'd, so cloning is cheap.
    fn clone(&self) -> Self {
        Self {
            client: self.client.clone(),
            base_url: self.base_url.clone(),
        }
    }
}

fn normalize_capabilities(capabilities: Option<Vec<String>>) -> Option<Vec<String>> {
    let capabilities = capabilities?
        .into_iter()
        .map(|capability| capability.trim().to_string())
        .filter(|capability| !capability.is_empty())
        .collect::<Vec<_>>();

    if capabilities.is_empty() {
        None
    } else {
        Some(capabilities)
    }
}

impl OllamaClient {
    #[cfg(debug_assertions)]
    fn format_duration(duration: Duration) -> String {
        if duration.as_secs() >= 1 {
            format!("{:.3}s", duration.as_secs_f64())
        } else if duration.as_millis() >= 1 {
            format!("{:.3}ms", duration.as_secs_f64() * 1000.0)
        } else {
            format!("{:.3}us", duration.as_secs_f64() * 1_000_000.0)
        }
    }

    #[cfg(debug_assertions)]
    fn slow_threshold(path: &str, ctx: &RequestContext) -> Duration {
        match (path, ctx.stream.unwrap_or(false)) {
            ("/api/chat", true) => Duration::from_secs(15),
            ("/api/chat", false) => Duration::from_secs(10),
            ("/api/embed", _) => Duration::from_secs(3),
            ("/api/tags", _) => Duration::from_millis(1500),
            _ => Duration::from_secs(5),
        }
    }

    #[cfg(debug_assertions)]
    fn severity(
        path: &str,
        duration: Duration,
        error: bool,
        cache: bool,
        ctx: &RequestContext,
    ) -> &'static str {
        if error {
            "ERR"
        } else if cache {
            "CACHE"
        } else if duration >= Self::slow_threshold(path, ctx) {
            "SLOW"
        } else {
            "OK"
        }
    }

    #[cfg(debug_assertions)]
    fn summary_fields(
        ctx: &RequestContext,
        method: &str,
        path: &str,
        duration: Option<Duration>,
        status: Option<u16>,
        extras: &[(&str, String)],
    ) -> Vec<String> {
        let mut parts = Vec::new();
        if let Some(source) = ctx.source {
            parts.push(format!("source={source}"));
        }
        if let Some(model) = ctx.model.as_deref() {
            parts.push(format!("model={model}"));
        }
        if let Some(request_id) = ctx.request_id.as_deref() {
            parts.push(format!("request_id={request_id}"));
        }
        if let Some(session_id) = ctx.session_id.as_deref() {
            parts.push(format!("session_id={session_id}"));
        }
        if let Some(stream) = ctx.stream {
            parts.push(format!("stream={stream}"));
        }
        parts.push(format!("method={method}"));
        parts.push(format!("path={path}"));
        if let Some(status) = status {
            parts.push(format!("status={status}"));
        }
        if let Some(duration) = duration {
            parts.push(format!("duration={}", Self::format_duration(duration)));
        }
        for (key, value) in extras {
            parts.push(format!("{key}={value}"));
        }
        parts
    }

    #[cfg(debug_assertions)]
    fn log_http_success(
        &self,
        method: &str,
        path: &str,
        status: u16,
        duration: Duration,
        ctx: &RequestContext,
        extras: &[(&str, String)],
    ) {
        let severity = Self::severity(path, duration, false, false, ctx);
        let fields = Self::summary_fields(ctx, method, path, Some(duration), Some(status), extras);
        let message = format!(
            "[{}] {}",
            severity,
            fields.join(" ")
        );
        // Route non-critical successes through the buffered logger at debug level.
        crate::logging::log_buffered("debug", "ollama", &message, "{}");
    }

    #[cfg(debug_assertions)]
    fn log_http_error(
        &self,
        method: &str,
        path: &str,
        duration: Duration,
        ctx: &RequestContext,
        error: &str,
        extras: &[(&str, String)],
    ) {
        let mut extra_parts = extras.to_vec();
        extra_parts.push(("error", error.to_string()));
        let fields = Self::summary_fields(ctx, method, path, Some(duration), None, &extra_parts);
        // Errors persist immediately (log_buffered short-circuits for "error" level).
        crate::logging::log_buffered("error", "ollama", &format!("[ERR] {}", fields.join(" ")), "{}");
    }

    #[cfg(debug_assertions)]
    fn log_cache_event(&self, path: &str, ctx: &RequestContext, cache_status: &str) {
        let extras = [("cache", cache_status.to_string())];
        let fields = Self::summary_fields(ctx, "GET", path, None, None, &extras);
        // Cache hits are the noisiest — aggregate them so repeated identical
        // messages collapse into a single DB row with a count.
        crate::logging::log_buffered_aggregated(
            "debug",
            "ollama",
            &format!("[CACHE] {}", fields.join(" ")),
            "{}",
        );
    }

    #[cfg(not(debug_assertions))]
    fn log_http_success(
        &self,
        _method: &str,
        _path: &str,
        _status: u16,
        _duration: Duration,
        _ctx: &RequestContext,
        _extras: &[(&str, String)],
    ) {
    }

    #[cfg(not(debug_assertions))]
    fn log_http_error(
        &self,
        _method: &str,
        _path: &str,
        _duration: Duration,
        _ctx: &RequestContext,
        _error: &str,
        _extras: &[(&str, String)],
    ) {
    }

    #[cfg(not(debug_assertions))]
    fn log_cache_event(&self, _path: &str, _ctx: &RequestContext, _cache_status: &str) {}

    fn validate_base_url(base_url: Option<String>) -> Result<String, String> {
        let candidate = base_url
            .map(|url| url.trim().to_string())
            .filter(|url| !url.is_empty())
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());

        let parsed =
            reqwest::Url::parse(&candidate).map_err(|e| format!("Invalid Ollama base URL: {e}"))?;

        match parsed.scheme() {
            "http" | "https" => {}
            other => {
                return Err(format!(
                    "Invalid Ollama base URL scheme: {other}. Only http and https are allowed."
                ));
            }
        }

        let Some(host) = parsed.host_str() else {
            return Err("Invalid Ollama base URL: missing host".to_string());
        };

        let is_local_host = matches!(host, "localhost" | "127.0.0.1" | "::1");
        if !is_local_host {
            return Err(format!(
                "Invalid Ollama base URL host: {host}. Only localhost, 127.0.0.1, or ::1 are allowed."
            ));
        }

        Ok(parsed.to_string().trim_end_matches('/').to_string())
    }

    pub(crate) fn clear_abort_flag(app: &AppHandle, session_id: &str) -> Result<(), String> {
        let abort_state = app.state::<StreamAbortState>();
        let mut abort_map = abort_state.0.lock().map_err(
            |e: std::sync::PoisonError<
                std::sync::MutexGuard<'_, std::collections::HashMap<String, StreamAbortEntry>>,
            >| e.to_string(),
        )?;
        abort_map.remove(session_id);
        Ok(())
    }

    fn register_abort_listener(
        app: &AppHandle,
        session_id: &str,
    ) -> Result<tokio::sync::oneshot::Receiver<()>, String> {
        let abort_state = app.state::<StreamAbortState>();
        let mut abort_map = abort_state.0.lock().map_err(
            |e: std::sync::PoisonError<
                std::sync::MutexGuard<'_, std::collections::HashMap<String, StreamAbortEntry>>,
            >| e.to_string(),
        )?;
        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
        let entry = abort_map
            .entry(session_id.to_string())
            .or_insert(StreamAbortEntry {
                aborted: false,
                cancel_tx: None,
            });
        entry.aborted = false;
        entry.cancel_tx = Some(cancel_tx);
        Ok(cancel_rx)
    }

    fn should_abort(app: &AppHandle, session_id: &str) -> Result<bool, String> {
        let abort_state = app.state::<StreamAbortState>();
        let abort_map = abort_state.0.lock().map_err(
            |e: std::sync::PoisonError<
                std::sync::MutexGuard<'_, std::collections::HashMap<String, StreamAbortEntry>>,
            >| e.to_string(),
        )?;
        let should_abort = abort_map
            .get(session_id)
            .map(|entry| entry.aborted)
            .unwrap_or(false);
        Ok(should_abort)
    }

    pub fn new(base_url: Option<String>) -> Result<Self, String> {
        Ok(Self {
            client: shared_http_client().clone(),
            base_url: Self::validate_base_url(base_url)?,
        })
    }

    /// Resolves the requested model name to an available one, with fallback logic.
    pub async fn resolve_model(&self, requested: &str) -> Result<String, String> {
        let models = self.list_models("resolve_model").await?;
        if models.is_empty() {
            return Err("No Ollama models found. Install a model with `ollama pull <model-name>` and ensure Ollama is running.".to_string());
        }

        // 1. Exact match
        if models.iter().any(|m| m.name == requested) {
            return Ok(requested.to_string());
        }

        // 2. Base name match (e.g. "llama3" matching "llama3:latest")
        if let Some(m) = models
            .iter()
            .find(|m| m.name.starts_with(&format!("{}:", requested)))
        {
            return Ok(m.name.clone());
        }

        // 3. Fallback to first available non-embedding model
        let chat_fallback = models
            .iter()
            .find(|m| !m.name.contains("embed"))
            .map(|m| m.name.clone());

        if let Some(fb) = chat_fallback {
            return Ok(fb);
        }

        // 4. Absolute fallback to first model
        Ok(models[0].name.clone())
    }

    /// Send a single non-streaming message and return the full response.
    pub async fn send_message(
        &self,
        source: &'static str,
        model: &str,
        messages: Vec<OllamaMessage>,
    ) -> Result<String, String> {
        self.send_message_observed(
            model,
            messages,
            &RequestContext {
                source: Some(source),
                ..Default::default()
            },
        )
        .await
    }

    /// Send a non-streaming message with an optional keep_alive duration.
    /// Pass `Some("0s")` to unload the model immediately after the call.
    pub async fn send_message_with_options(
        &self,
        source: &'static str,
        model: &str,
        messages: Vec<OllamaMessage>,
        keep_alive: Option<&str>,
    ) -> Result<String, String> {
        self.send_message_with_options_observed(
            model,
            messages,
            keep_alive,
            &RequestContext {
                source: Some(source),
                ..Default::default()
            },
        )
        .await
    }

    pub async fn send_message_observed(
        &self,
        model: &str,
        messages: Vec<OllamaMessage>,
        ctx: &RequestContext,
    ) -> Result<String, String> {
        self.send_message_with_options_observed(model, messages, None, ctx)
            .await
    }

    pub async fn send_message_with_options_observed(
        &self,
        model: &str,
        messages: Vec<OllamaMessage>,
        keep_alive: Option<&str>,
        ctx: &RequestContext,
    ) -> Result<String, String> {
        let resolved_model = self.resolve_model(model).await?;
        let url = format!("{}/api/chat", self.base_url);
        let started_at = Instant::now();
        let num_ctx = crate::services::context_assembler::context_size_for_model(&resolved_model);
        let mut body = json!({
            "model": resolved_model,
            "messages": messages,
            "stream": false,
            "options": { "num_ctx": num_ctx }
        });
        if let Some(ka) = keep_alive {
            body.as_object_mut()
                .unwrap()
                .insert("keep_alive".to_string(), json!(ka));
        }

        let mut req = self.client.post(&url).json(&body);
        if let Some(t) = ctx.timeout_override {
            req = req.timeout(t);
        }
        let response = req
            .send()
            .await
            .map_err(|e| {
                let message = format!("Ollama connection error: {e}");
                self.log_http_error(
                    "POST",
                    "/api/chat",
                    started_at.elapsed(),
                    ctx,
                    &message,
                    &[],
                );
                message
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            let message = format!("Ollama error {status}: {text}");
            self.log_http_error(
                "POST",
                "/api/chat",
                started_at.elapsed(),
                ctx,
                &message,
                &[("status", status.as_u16().to_string())],
            );
            return Err(message);
        }

        let status = response.status().as_u16();
        let chat_response: ChatResponse = response.json().await.map_err(|e| {
            let message = format!("Failed to parse Ollama response: {e}");
            self.log_http_error(
                "POST",
                "/api/chat",
                started_at.elapsed(),
                ctx,
                &message,
                &[],
            );
            message
        })?;

        self.log_http_success("POST", "/api/chat", status, started_at.elapsed(), ctx, &[]);

        Ok(chat_response.message.content)
    }

    /// Internal helper: stream a chat response and emit events with a given prefix.
    /// The event emitted is "{event_prefix}{session_id}".
    async fn stream_with_prefix(
        &self,
        app: &AppHandle,
        session_id: &str,
        model: &str,
        messages: Vec<OllamaMessage>,
        event_prefix: &str,
        manage_abort_flag: bool,
        ctx: &RequestContext,
    ) -> Result<String, String> {
        if manage_abort_flag {
            Self::clear_abort_flag(app, session_id)?;
        }
        let resolved_model = self.resolve_model(model).await?;
        let url = format!("{}/api/chat", self.base_url);
        let started_at = Instant::now();
        let num_ctx = crate::services::context_assembler::context_size_for_model(&resolved_model);
        let body = json!({
            "model": resolved_model,
            "messages": messages,
            "stream": true,
            "options": { "num_ctx": num_ctx }
        });

        // Use the streaming-tuned client so a long generation can't be killed
        // by the 300-second body timeout that applies to the shared client.
        let response = streaming_http_client()
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                let message = if e.is_connect() {
                    format!("Ollama is not reachable at {}: {e}", self.base_url)
                } else {
                    format!("Ollama connection error: {e}")
                };
                self.log_http_error(
                    "POST",
                    "/api/chat",
                    started_at.elapsed(),
                    ctx,
                    &message,
                    &[],
                );
                message
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            let message = format!("Ollama error {status}: {text}");
            self.log_http_error(
                "POST",
                "/api/chat",
                started_at.elapsed(),
                ctx,
                &message,
                &[("status", status.as_u16().to_string())],
            );
            return Err(message);
        }

        let status = response.status().as_u16();
        let mut full_response = String::new();
        let mut stream = response.bytes_stream();
        let mut stream_done = false;
        let mut aborted = false;
        let mut cancel_rx = Self::register_abort_listener(app, session_id)?;
        let mut pending_chunk = String::new();
        // Byte-level accumulator to guard against two failure modes:
        //  1. Multi-byte UTF-8 character split across two network chunks
        //     (std::str::from_utf8 would return an error on the partial sequence).
        //  2. A large JSON object whose newline-delimited boundary arrives in a
        //     later chunk than the opening brace (serde_json::from_str would fail).
        // We accumulate raw bytes and only extract complete newline-terminated
        // lines before converting to UTF-8 and parsing.
        let mut byte_buf: Vec<u8> = Vec::new();
        let mut last_emit = std::time::Instant::now();
        const EMIT_INTERVAL: std::time::Duration = std::time::Duration::from_millis(50);

        loop {
            if Self::should_abort(app, session_id)? {
                aborted = true;
                break;
            }

            let chunk_result = tokio::select! {
                _ = &mut cancel_rx => {
                    aborted = true;
                    break;
                }
                next_chunk = stream.next() => next_chunk,
                _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => {
                    // Flush any pending text on timeout
                    if !pending_chunk.is_empty() {
                        let event_name = format!("{event_prefix}{session_id}");
                        let _ = app.emit(&event_name, StreamEvent {
                            session_id: session_id.to_string(),
                            chunk: std::mem::take(&mut pending_chunk),
                            done: false,
                            tokens_used: None,
                            duration_ms: None,
                            load_duration_ms: None,
                        });
                        last_emit = std::time::Instant::now();
                    }
                    continue;
                }
            };

            let Some(chunk_result) = chunk_result else {
                break;
            };
            let chunk = match chunk_result {
                Ok(chunk) => chunk,
                Err(e) => {
                    // If the stream errors before we've parsed any chunks, the
                    // most likely cause is the model OOMing during load.
                    // Surface a more actionable message in that case.
                    let elapsed = started_at.elapsed();
                    let message = if full_response.is_empty() {
                        format!(
                            "Stream error after {:.1}s before any output — model '{}' likely failed to load (out of memory or runner crashed). {e}",
                            elapsed.as_secs_f64(),
                            resolved_model
                        )
                    } else {
                        format!("Stream error: {e}")
                    };
                    self.log_http_error(
                        "POST",
                        "/api/chat",
                        elapsed,
                        ctx,
                        &message,
                        &[],
                    );
                    // Free the runner — most stream errors here are caused by
                    // the model OOMing or being killed, which leaves the entry
                    // in /api/ps until keep_alive expires.
                    self.unload_model_in_background("stream_error", &resolved_model);
                    if manage_abort_flag {
                        let _ = Self::clear_abort_flag(app, session_id);
                    }
                    return Err(message);
                }
            };
            byte_buf.extend_from_slice(&chunk);
            // Drain all complete newline-terminated lines from the buffer.
            // Any trailing bytes that don't yet end in '\n' stay in the buffer
            // and will be prepended to the next chunk, preserving both UTF-8
            // sequence integrity and JSON object completeness.
            while let Some(nl_pos) = byte_buf.iter().position(|&b| b == b'\n') {
                let line_bytes: Vec<u8> = byte_buf.drain(..=nl_pos).collect();
                let line_str = String::from_utf8_lossy(&line_bytes);
                let line = line_str.trim();
                if line.is_empty() {
                    continue;
                }
                if let Ok(parsed) = serde_json::from_str::<StreamChunk>(line) {
                    let content = parsed.message.content.clone();
                    full_response.push_str(&content);

                    let event_name = format!("{event_prefix}{session_id}");
                    if parsed.done {
                        // Flush any pending text together with the final chunk
                        pending_chunk.push_str(&content);
                        let duration_ms = parsed
                            .total_duration
                            .map(|ns| ns / 1_000_000);
                        let load_duration_ms = parsed
                            .load_duration
                            .map(|ns| ns / 1_000_000);
                        let _ = app.emit(
                            &event_name,
                            StreamEvent {
                                session_id: session_id.to_string(),
                                chunk: std::mem::take(&mut pending_chunk),
                                done: true,
                                tokens_used: parsed.eval_count,
                                duration_ms,
                                load_duration_ms,
                            },
                        );
                        stream_done = true;
                        break;
                    } else {
                        pending_chunk.push_str(&content);
                        // Emit batched chunk if enough time has passed
                        if last_emit.elapsed() >= EMIT_INTERVAL {
                            let _ = app.emit(
                                &event_name,
                                StreamEvent {
                                    session_id: session_id.to_string(),
                                    chunk: std::mem::take(&mut pending_chunk),
                                    done: false,
                                    tokens_used: None,
                                    duration_ms: None,
                                    load_duration_ms: None,
                                },
                            );
                            last_emit = std::time::Instant::now();
                        }
                    }
                }
            }
            if stream_done {
                break;
            }
        }

        if !stream_done {
            let _ = app.emit(
                &format!("{event_prefix}{session_id}"),
                StreamEvent {
                    session_id: session_id.to_string(),
                    chunk: String::new(),
                    done: true,
                    tokens_used: None,
                    duration_ms: None,
                    load_duration_ms: None,
                },
            );
        }
        if manage_abort_flag {
            Self::clear_abort_flag(app, session_id)?;
        }

        let mut extras = Vec::new();
        if aborted {
            extras.push(("outcome", "aborted".to_string()));
            // User asked to stop — unload to free RAM rather than leaving the
            // model resident for keep_alive's default 5 minutes.
            self.unload_model_in_background("stream_aborted", &resolved_model);
        } else if !stream_done {
            extras.push(("outcome", "incomplete".to_string()));
            self.unload_model_in_background("stream_incomplete", &resolved_model);
        } else {
            extras.push(("outcome", "completed".to_string()));
        }
        self.log_http_success(
            "POST",
            "/api/chat",
            status,
            started_at.elapsed(),
            ctx,
            &extras,
        );

        Ok(full_response)
    }

    /// Stream a chat response, emitting chunks as Tauri events.
    /// Event name: "ollama-stream-{session_id}"
    pub async fn stream_message(
        &self,
        source: &'static str,
        app: &AppHandle,
        session_id: &str,
        model: &str,
        messages: Vec<OllamaMessage>,
    ) -> Result<String, String> {
        self.stream_message_observed(
            app,
            session_id,
            model,
            messages,
            &RequestContext {
                source: Some(source),
                session_id: Some(session_id.to_string()),
                ..Default::default()
            },
        )
        .await
    }

    pub async fn stream_message_observed(
        &self,
        app: &AppHandle,
        session_id: &str,
        model: &str,
        messages: Vec<OllamaMessage>,
        ctx: &RequestContext,
    ) -> Result<String, String> {
        self.stream_with_prefix(
            app,
            session_id,
            model,
            messages,
            "ollama-stream-",
            true,
            ctx,
        )
        .await
    }

    pub async fn stream_message_unmanaged(
        &self,
        source: &'static str,
        app: &AppHandle,
        session_id: &str,
        model: &str,
        messages: Vec<OllamaMessage>,
    ) -> Result<String, String> {
        self.stream_message_unmanaged_observed(
            app,
            session_id,
            model,
            messages,
            &RequestContext {
                source: Some(source),
                session_id: Some(session_id.to_string()),
                ..Default::default()
            },
        )
        .await
    }

    pub async fn stream_message_unmanaged_observed(
        &self,
        app: &AppHandle,
        session_id: &str,
        model: &str,
        messages: Vec<OllamaMessage>,
        ctx: &RequestContext,
    ) -> Result<String, String> {
        self.stream_with_prefix(
            app,
            session_id,
            model,
            messages,
            "ollama-stream-",
            false,
            ctx,
        )
        .await
    }

    /// Stream the refined (large-model) response, emitting chunks as Tauri events.
    /// Event name: "ollama-refine-{session_id}"
    pub async fn stream_refine_message(
        &self,
        source: &'static str,
        app: &AppHandle,
        session_id: &str,
        model: &str,
        messages: Vec<OllamaMessage>,
    ) -> Result<String, String> {
        self.stream_refine_message_observed(
            app,
            session_id,
            model,
            messages,
            &RequestContext {
                source: Some(source),
                session_id: Some(session_id.to_string()),
                ..Default::default()
            },
        )
        .await
    }

    pub async fn stream_refine_message_observed(
        &self,
        app: &AppHandle,
        session_id: &str,
        model: &str,
        messages: Vec<OllamaMessage>,
        ctx: &RequestContext,
    ) -> Result<String, String> {
        self.stream_with_prefix(
            app,
            session_id,
            model,
            messages,
            "ollama-refine-",
            true,
            ctx,
        )
        .await
    }

    pub async fn stream_refine_message_unmanaged(
        &self,
        source: &'static str,
        app: &AppHandle,
        session_id: &str,
        model: &str,
        messages: Vec<OllamaMessage>,
    ) -> Result<String, String> {
        self.stream_refine_message_unmanaged_observed(
            app,
            session_id,
            model,
            messages,
            &RequestContext {
                source: Some(source),
                session_id: Some(session_id.to_string()),
                ..Default::default()
            },
        )
        .await
    }

    pub async fn stream_refine_message_unmanaged_observed(
        &self,
        app: &AppHandle,
        session_id: &str,
        model: &str,
        messages: Vec<OllamaMessage>,
        ctx: &RequestContext,
    ) -> Result<String, String> {
        self.stream_with_prefix(
            app,
            session_id,
            model,
            messages,
            "ollama-refine-",
            false,
            ctx,
        )
        .await
    }

    /// Generate an embedding vector for the given text.
    pub async fn generate_embedding(
        &self,
        source: &'static str,
        model: &str,
        text: &str,
    ) -> Result<Vec<f32>, String> {
        self.generate_embedding_observed(
            model,
            text,
            &RequestContext {
                source: Some(source),
                model: Some(model.to_string()),
                ..Default::default()
            },
        )
        .await
    }

    /// Generate an embedding with an optional keep_alive duration.
    /// Pass `Some("0s")` to unload the model immediately after the call.
    pub async fn generate_embedding_with_options(
        &self,
        source: &'static str,
        model: &str,
        text: &str,
        keep_alive: Option<&str>,
    ) -> Result<Vec<f32>, String> {
        self.generate_embedding_with_options_observed(
            model,
            text,
            keep_alive,
            &RequestContext {
                source: Some(source),
                model: Some(model.to_string()),
                ..Default::default()
            },
        )
        .await
    }

    pub async fn generate_embedding_observed(
        &self,
        model: &str,
        text: &str,
        ctx: &RequestContext,
    ) -> Result<Vec<f32>, String> {
        self.generate_embedding_with_options_observed(model, text, None, ctx)
            .await
    }

    pub async fn generate_embedding_with_options_observed(
        &self,
        model: &str,
        text: &str,
        keep_alive: Option<&str>,
        ctx: &RequestContext,
    ) -> Result<Vec<f32>, String> {
        // Guard: verify the model is locally available before calling /api/embed.
        let available = self.list_models_observed(ctx).await.unwrap_or_default();
        if !available
            .iter()
            .any(|m| m.name == model || m.name.starts_with(&format!("{model}:")))
        {
            return Err(format!(
                "Embedding model '{model}' is not available locally. Run: ollama pull {model}"
            ));
        }

        let url = format!("{}/api/embed", self.base_url);
        let started_at = Instant::now();
        let mut body = json!({ "model": model, "input": text });
        if let Some(ka) = keep_alive {
            body.as_object_mut()
                .unwrap()
                .insert("keep_alive".to_string(), json!(ka));
        }

        let response = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                let message = format!("Embedding request failed: {e}");
                self.log_http_error(
                    "POST",
                    "/api/embed",
                    started_at.elapsed(),
                    ctx,
                    &message,
                    &[],
                );
                message
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            let message = format!("Ollama error {status}: {text}");
            self.log_http_error(
                "POST",
                "/api/embed",
                started_at.elapsed(),
                ctx,
                &message,
                &[("status", status.as_u16().to_string())],
            );
            return Err(message);
        }

        let status = response.status().as_u16();
        let emb: EmbeddingResponse = response.json().await.map_err(|e| {
            let message = format!("Failed to parse embedding: {e}");
            self.log_http_error(
                "POST",
                "/api/embed",
                started_at.elapsed(),
                ctx,
                &message,
                &[],
            );
            message
        })?;

        self.log_http_success("POST", "/api/embed", status, started_at.elapsed(), ctx, &[]);

        emb.embeddings
            .into_iter()
            .next()
            .ok_or_else(|| "Ollama returned no embedding vectors".to_string())
    }

    /// Fetch list of locally available models, with a 30-second process-level cache.
    /// This eliminates the redundant GET /api/tags that was issued before every /api/chat.
    pub async fn list_models(&self, source: &'static str) -> Result<Vec<ModelInfo>, String> {
        self.list_models_observed(&RequestContext {
            source: Some(source),
            ..Default::default()
        })
        .await
    }

    pub async fn list_models_observed(
        &self,
        ctx: &RequestContext,
    ) -> Result<Vec<ModelInfo>, String> {
        // Check cache first (hold the lock only briefly).
        {
            let guard = model_cache()
                .lock()
                .map_err(|e| format!("model cache lock poisoned: {e}"))?;
            if let Some(cached) = guard.as_ref() {
                if cached.url == self.base_url && cached.fetched_at.elapsed() < MODEL_CACHE_TTL {
                    self.log_cache_event("/api/tags", ctx, "hit");
                    return Ok(cached.models.clone());
                }
            }
        }

        // Cache miss — fetch from Ollama.
        let url = format!("{}/api/tags", self.base_url);
        let started_at = Instant::now();
        let response = self.client.get(&url).send().await.map_err(|e| {
            let message = format!("Failed to fetch models: {e}");
            self.log_http_error(
                "GET",
                "/api/tags",
                started_at.elapsed(),
                ctx,
                &message,
                &[("cache", "miss".to_string())],
            );
            message
        })?;

        if !response.status().is_success() {
            let message = format!("Ollama returned status {}", response.status());
            self.log_http_error(
                "GET",
                "/api/tags",
                started_at.elapsed(),
                ctx,
                &message,
                &[
                    ("cache", "miss".to_string()),
                    ("status", response.status().as_u16().to_string()),
                ],
            );
            return Err(message);
        }

        let status = response.status().as_u16();
        let tags: TagsResponse = response.json().await.map_err(|e| {
            let message = format!("Failed to parse models list: {e}");
            self.log_http_error(
                "GET",
                "/api/tags",
                started_at.elapsed(),
                ctx,
                &message,
                &[("cache", "miss".to_string())],
            );
            message
        })?;

        let models = self.enrich_models_with_capabilities(tags.models, ctx).await;

        // Store in cache (without awaiting capability fetches — they're fetched in the background).
        {
            let mut guard = model_cache()
                .lock()
                .map_err(|e| format!("model cache lock poisoned: {e}"))?;
            *guard = Some(CachedModels {
                models: models.clone(),
                fetched_at: Instant::now(),
                url: self.base_url.clone(),
            });
        }

        self.log_http_success(
            "GET",
            "/api/tags",
            status,
            started_at.elapsed(),
            ctx,
            &[("cache", "miss".to_string())],
        );

        Ok(models)
    }

    async fn enrich_models_with_capabilities(
        &self,
        models: Vec<ModelInfo>,
        ctx: &RequestContext,
    ) -> Vec<ModelInfo> {
        // Fetch model capabilities sequentially to avoid overwhelming Ollama with
        // parallel /api/show requests, which can cause connection errors on startup.
        // The capability cache (10-minute TTL) ensures that repeat calls are cheap.
        // This replaces the previous join_all() which created a thundering herd of
        // parallel requests when multiple concurrent calls (resolve_model, ensure_ollama_running,
        // list_models_fresh) raced to fetch the model list at app startup.
        let total = models.len();
        let mut success_count: usize = 0;
        let mut cache_count: usize = 0;
        let started_at = Instant::now();

        let mut enriched = Vec::new();
        for model in models {
            // Check capability cache to distinguish cache hits from network fetches.
            let was_cached = {
                if let Ok(guard) = capability_cache().lock() {
                    guard.entries.get(&(self.base_url.clone(), model.name.clone()))
                        .map(|(_, fetched_at)| fetched_at.elapsed() < CAPABILITY_CACHE_TTL)
                        .unwrap_or(false)
                } else {
                    false
                }
            };

            let mut enriched_model = model;
            let caps = self.fetch_model_capabilities_observed(&enriched_model.name, ctx).await;
            enriched_model.capabilities = caps;

            if was_cached {
                cache_count += 1;
            } else {
                // fetch_model_capabilities_observed stores in cache on success
                // so if it's in cache now, it succeeded
                success_count += 1;
            }

            enriched.push(enriched_model);
        }

        let fail_count = total.saturating_sub(success_count + cache_count);

        // Emit a single summary instead of per-model logs.
        let elapsed = started_at.elapsed();
        crate::logging::log_buffered(
            "info",
            "ollama",
            &format!(
                "[CAPABILITY_REFRESH] models_checked={} success={} cached={} failed={} duration={}",
                total,
                success_count,
                cache_count,
                fail_count,
                if elapsed.as_secs() >= 1 {
                    format!("{:.3}s", elapsed.as_secs_f64())
                } else {
                    format!("{:.3}ms", elapsed.as_secs_f64() * 1000.0)
                },
            ),
            "{}",
        );

        enriched
    }

    async fn fetch_model_capabilities_observed(
        &self,
        model: &str,
        ctx: &RequestContext,
    ) -> Option<Vec<String>> {
        // Check the long-lived per-model capability cache first.
        // This prevents N parallel /api/show calls every 30s when the model
        // list cache expires — capabilities only change after `ollama pull`.
        // Keyed by (base_url, model) so different local Ollama servers that
        // share a model name don't serve each other's stale capability data.
        {
            if let Ok(guard) = capability_cache().lock() {
                if let Some((caps, fetched_at)) = guard.entries.get(&(self.base_url.clone(), model.to_string())) {
                    if fetched_at.elapsed() < CAPABILITY_CACHE_TTL {
                        return caps.clone();
                    }
                }
            }
        }

        let url = format!("{}/api/show", self.base_url);
        let started_at = Instant::now();
        let response = match self
            .client
            .post(&url)
            .json(&ShowModelRequest {
                model: model.to_string(),
            })
            .send()
            .await
        {
            Ok(response) => response,
            Err(e) => {
                self.log_http_error(
                    "POST",
                    "/api/show",
                    started_at.elapsed(),
                    ctx,
                    &format!("Failed to fetch model details for {model}: {e}"),
                    &[("model", model.to_string())],
                );
                return None;
            }
        };

        if !response.status().is_success() {
            self.log_http_error(
                "POST",
                "/api/show",
                started_at.elapsed(),
                ctx,
                &format!("Ollama returned status {} for model details", response.status()),
                &[
                    ("model", model.to_string()),
                    ("status", response.status().as_u16().to_string()),
                ],
            );
            return None;
        }

        let status = response.status().as_u16();
        let details: ShowModelResponse = match response.json().await {
            Ok(details) => details,
            Err(e) => {
                self.log_http_error(
                    "POST",
                    "/api/show",
                    started_at.elapsed(),
                    ctx,
                    &format!("Failed to parse model details for {model}: {e}"),
                    &[("model", model.to_string())],
                );
                return None;
            }
        };

        self.log_http_success(
            "POST",
            "/api/show",
            status,
            started_at.elapsed(),
            ctx,
            &[("model", model.to_string())],
        );

        let caps = normalize_capabilities(details.capabilities);
        // Store in long-lived cache so this model doesn't need /api/show again
        // for CAPABILITY_CACHE_TTL regardless of how many times the model list
        // cache expires.
        if let Ok(mut guard) = capability_cache().lock() {
            guard.entries.insert((self.base_url.clone(), model.to_string()), (caps.clone(), Instant::now()));
        }
        caps
    }

    /// Force-flush the process-level model cache and capability cache.
    /// Called whenever the user explicitly refreshes the model list.
    pub fn invalidate_model_cache(&self) {
        if let Ok(mut guard) = model_cache().lock() {
            *guard = None;
        }
        if let Ok(mut guard) = capability_cache().lock() {
            guard.entries.clear();
        }
    }

    /// Generate a short title for a chat session given the first user message.
    pub async fn generate_title(
        &self,
        source: &'static str,
        model: &str,
        first_message: &str,
    ) -> Result<String, String> {
        self.generate_title_observed(
            model,
            first_message,
            &RequestContext {
                source: Some(source),
                model: Some(model.to_string()),
                ..Default::default()
            },
        )
        .await
    }

    pub async fn generate_title_observed(
        &self,
        model: &str,
        first_message: &str,
        ctx: &RequestContext,
    ) -> Result<String, String> {
        let prompt = format!(
            "Generate a short (3-6 word) title for a conversation that starts with: \"{first_message}\". \
            Output ONLY the title, no quotes, no punctuation at the end."
        );
        let messages = vec![OllamaMessage {
            role: "user".to_string(),
            content: prompt,
        }];
        let title = self.send_message_observed(model, messages, ctx).await?;
        Ok(title.trim().to_string())
    }

    /// Generate a title from a full conversation history (for periodic refresh).
    pub async fn generate_title_from_conversation(
        &self,
        source: &'static str,
        model: &str,
        conversation: Vec<OllamaMessage>,
    ) -> Result<String, String> {
        self.generate_title_from_conversation_observed(
            model,
            conversation,
            &RequestContext {
                source: Some(source),
                model: Some(model.to_string()),
                ..Default::default()
            },
        )
        .await
    }

    pub async fn generate_title_from_conversation_observed(
        &self,
        model: &str,
        conversation: Vec<OllamaMessage>,
        ctx: &RequestContext,
    ) -> Result<String, String> {
        // Build a summary of the conversation for the title prompt
        let summary: String = conversation
            .iter()
            .filter(|m| m.role == "user")
            .take(10)
            .map(|m| {
                let truncated: String = m.content.chars().take(200).collect();
                format!("- {truncated}")
            })
            .collect::<Vec<_>>()
            .join("\n");

        let prompt = format!(
            "Based on this conversation, generate a short (3-6 word) title that captures the main topic.\n\n\
            User messages:\n{summary}\n\n\
            Output ONLY the title, no quotes, no punctuation at the end."
        );
        let messages = vec![OllamaMessage {
            role: "user".to_string(),
            content: prompt,
        }];
        let title = self.send_message_observed(model, messages, ctx).await?;
        Ok(title.trim().to_string())
    }

    /// Unload a model from Ollama's runner cache by issuing an empty generate
    /// request with `keep_alive: 0`. Frees the RAM/VRAM the model was holding
    /// without restarting the Ollama process. Errors are returned but callers
    /// often treat this as best-effort cleanup.
    pub async fn unload_model(&self, source: &'static str, model: &str) -> Result<(), String> {
        let ctx = RequestContext {
            source: Some(source),
            model: Some(model.to_string()),
            ..Default::default()
        };
        self.unload_model_observed(model, &ctx).await
    }

    pub async fn unload_model_observed(
        &self,
        model: &str,
        ctx: &RequestContext,
    ) -> Result<(), String> {
        let url = format!("{}/api/generate", self.base_url);
        let started_at = Instant::now();
        let body = json!({
            "model": model,
            "prompt": "",
            "keep_alive": 0,
            "stream": false,
        });

        let response = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                let message = format!("Unload request failed: {e}");
                self.log_http_error(
                    "POST",
                    "/api/generate",
                    started_at.elapsed(),
                    ctx,
                    &message,
                    &[("model", model.to_string()), ("op", "unload".to_string())],
                );
                message
            })?;

        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            let message = format!("Ollama unload error {status}: {text}");
            self.log_http_error(
                "POST",
                "/api/generate",
                started_at.elapsed(),
                ctx,
                &message,
                &[
                    ("model", model.to_string()),
                    ("op", "unload".to_string()),
                    ("status", status.as_u16().to_string()),
                ],
            );
            return Err(message);
        }

        // Drain the body (response is a final JSON object with done=true).
        let _ = response.text().await;

        self.log_http_success(
            "POST",
            "/api/generate",
            status.as_u16(),
            started_at.elapsed(),
            ctx,
            &[("model", model.to_string()), ("op", "unload".to_string())],
        );
        Ok(())
    }

    /// Best-effort fire-and-forget unload. Spawns a task and discards errors.
    /// Used from streaming error/abort paths where we don't want to block.
    pub fn unload_model_in_background(&self, source: &'static str, model: &str) {
        let client = self.clone();
        let model = model.to_string();
        tokio::spawn(async move {
            let _ = client.unload_model(source, &model).await;
        });
    }

    /// Query Ollama `/api/ps` for the currently-loaded model list.
    /// Returned models include `size_vram` so the UI can display memory use.
    pub async fn list_loaded_models(&self, source: &'static str) -> Result<Vec<LoadedModelInfo>, String> {
        let ctx = RequestContext {
            source: Some(source),
            ..Default::default()
        };
        self.list_loaded_models_observed(&ctx).await
    }

    pub async fn list_loaded_models_observed(
        &self,
        ctx: &RequestContext,
    ) -> Result<Vec<LoadedModelInfo>, String> {
        let url = format!("{}/api/ps", self.base_url);
        let started_at = Instant::now();
        let response = self.client.get(&url).send().await.map_err(|e| {
            let message = format!("Failed to query loaded models: {e}");
            self.log_http_error(
                "GET",
                "/api/ps",
                started_at.elapsed(),
                ctx,
                &message,
                &[],
            );
            message
        })?;

        if !response.status().is_success() {
            let message = format!("Ollama returned status {} for /api/ps", response.status());
            self.log_http_error(
                "GET",
                "/api/ps",
                started_at.elapsed(),
                ctx,
                &message,
                &[("status", response.status().as_u16().to_string())],
            );
            return Err(message);
        }

        let status = response.status().as_u16();
        let parsed: LoadedModelsResponse = response.json().await.map_err(|e| {
            let message = format!("Failed to parse /api/ps: {e}");
            self.log_http_error(
                "GET",
                "/api/ps",
                started_at.elapsed(),
                ctx,
                &message,
                &[],
            );
            message
        })?;
        self.log_http_success("GET", "/api/ps", status, started_at.elapsed(), ctx, &[]);
        Ok(parsed.models)
    }
}

/// Cosine similarity between two embedding vectors.
use ndarray::ArrayView1;

pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let a_arr = ArrayView1::from(a);
    let b_arr = ArrayView1::from(b);

    let dot = a_arr.dot(&b_arr);
    let norm_a = a_arr.dot(&a_arr).sqrt();
    let norm_b = b_arr.dot(&b_arr).sqrt();

    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a * norm_b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_capabilities_discards_empty_entries() {
        assert_eq!(
            normalize_capabilities(Some(vec![
                "vision".to_string(),
                "".to_string(),
                "  ".to_string()
            ])),
            Some(vec!["vision".to_string()])
        );
    }

    #[test]
    fn normalize_capabilities_returns_none_when_empty() {
        assert_eq!(normalize_capabilities(Some(vec![])), None);
        assert_eq!(normalize_capabilities(None), None);
    }

    #[test]
    fn test_cosine_similarity_identical() {
        let v = vec![1.0f32, 2.0, 3.0];
        assert!((cosine_similarity(&v, &v) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_cosine_similarity_orthogonal() {
        let a = vec![1.0f32, 0.0];
        let b = vec![0.0f32, 1.0];
        assert!((cosine_similarity(&a, &b)).abs() < 1e-6);
    }

    #[test]
    fn test_cosine_similarity_empty() {
        assert_eq!(cosine_similarity(&[], &[]), 0.0);
    }
}
