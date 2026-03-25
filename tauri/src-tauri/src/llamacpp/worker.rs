use llama_cpp_2::{
    LlamaBackend, LlamaModel,
    model::params::LlamaModelParams,
    context::params::LlamaContextParams,
    llama_batch::LlamaBatch,
    model::AddBos,
};
use std::sync::{mpsc, Mutex};
use tauri::{AppHandle, Emitter};
use crate::ollama::client::StreamEvent;
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

pub struct InferenceRequest {
    pub session_id: String,
    pub messages: Vec<ChatMessage>,
    pub model_path: String,
    pub cancel_rx: oneshot::Receiver<()>,
}

pub struct LlamacppWorkerState {
    pub tx: Mutex<mpsc::SyncSender<InferenceRequest>>,
}

pub fn spawn_inference_worker(app: AppHandle) -> LlamacppWorkerState {
    let (tx, rx) = mpsc::sync_channel::<InferenceRequest>(1);

    std::thread::spawn(move || {
        let backend = LlamaBackend::init().expect("Failed to initialize llama backend");
        let mut loaded: Option<(String, LlamaModel)> = None;

        for req in rx {
            // Load model if path changed or not loaded
            let model = match loaded {
                Some((ref p, ref m)) if p == &req.model_path => m,
                _ => {
                    let params = LlamaModelParams::default();
                    match LlamaModel::load_from_file(&backend, &req.model_path, &params) {
                        Ok(m) => {
                            loaded = Some((req.model_path.clone(), m));
                            &loaded.as_ref().unwrap().1
                        }
                        Err(e) => {
                            let event_name = format!("ollama-stream-{}", req.session_id);
                            let _ = app.emit(&event_name, StreamEvent {
                                session_id: req.session_id.clone(),
                                chunk: format!("\n\n⚠️ Failed to load model: {}", e),
                                done: true,
                                tokens_used: None,
                                duration_ms: None,
                            });
                            continue;
                        }
                    }
                }
            };

            let ctx_params = LlamaContextParams::default();
            let mut ctx = match model.new_context(&backend, ctx_params) {
                Ok(c) => c,
                Err(e) => {
                    let event_name = format!("ollama-stream-{}", req.session_id);
                    let _ = app.emit(&event_name, StreamEvent {
                        session_id: req.session_id.clone(),
                        chunk: format!("\n\n⚠️ Failed to create context: {}", e),
                        done: true,
                        tokens_used: None,
                        duration_ms: None,
                    });
                    continue;
                }
            };

            // Apply chat template if available, otherwise join messages
            let prompt = match model.chat_template(None) {
                Ok(tmpl) => {
                    let llama_msgs: Vec<_> = req.messages.iter()
                        .map(|m| llama_cpp_2::model::LlamaChatMessage {
                            role: m.role.clone(),
                            content: m.content.clone(),
                        })
                        .collect();
                    match model.apply_chat_template(tmpl, &llama_msgs, true) {
                        Ok(p) => p,
                        Err(_) => fallback_prompt(&req.messages),
                    }
                }
                Err(_) => fallback_prompt(&req.messages),
            };

            let tokens = match model.str_to_token(&prompt, AddBos::Yes) {
                Ok(t) => t,
                Err(e) => {
                    let event_name = format!("ollama-stream-{}", req.session_id);
                    let _ = app.emit(&event_name, StreamEvent {
                        session_id: req.session_id.clone(),
                        chunk: format!("\n\n⚠️ Tokenization error: {}", e),
                        done: true,
                        tokens_used: None,
                        duration_ms: None,
                    });
                    continue;
                }
            };

            // Initial decode
            let mut batch = LlamaBatch::new(tokens.len().max(512), 1);
            for (i, &tok) in tokens.iter().enumerate() {
                let logits = i == tokens.len() - 1;
                if let Err(e) = batch.add(tok, i as i32, &[0], logits) {
                    eprintln!("Failed to add to batch: {}", e);
                    break;
                }
            }
            
            if let Err(e) = ctx.decode(&mut batch) {
                let event_name = format!("ollama-stream-{}", req.session_id);
                let _ = app.emit(&event_name, StreamEvent {
                    session_id: req.session_id.clone(),
                    chunk: format!("\n\n⚠️ Decode error: {}", e),
                    done: true,
                    tokens_used: None,
                    duration_ms: None,
                });
                continue;
            }

            // Generation loop
            let eos = model.token_eos();
            let event_name = format!("ollama-stream-{}", req.session_id);
            let start = std::time::Instant::now();
            let mut pos = tokens.len() as i32;
            let mut total_tokens: i64 = 0;
            let mut cancel_rx = req.cancel_rx;

            loop {
                // Check cancel
                if cancel_rx.try_recv().is_ok() {
                    break;
                }

                // Sample next token (greedy)
                let logits = ctx.get_logits_ith(batch.n_tokens() - 1).expect("Failed to get logits");
                let next_tok_id = logits.iter().enumerate()
                    .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
                    .map(|(i, _)| i as i32)
                    .unwrap_or(eos.0);
                let next_tok = llama_cpp_2::token::LlamaToken(next_tok_id);

                if next_tok == eos {
                    break;
                }

                let tok_str = model.token_to_str(next_tok, llama_cpp_2::token::Special::Auto).unwrap_or_default();
                total_tokens += 1;

                let _ = app.emit(&event_name, StreamEvent {
                    session_id: req.session_id.clone(),
                    chunk: tok_str,
                    done: false,
                    tokens_used: None,
                    duration_ms: None,
                });

                batch.clear();
                if let Err(e) = batch.add(next_tok, pos, &[0], true) {
                    eprintln!("Failed to add to batch: {}", e);
                    break;
                }
                if let Err(e) = ctx.decode(&mut batch) {
                    eprintln!("Decode error: {}", e);
                    break;
                }
                pos += 1;
                
                // Safety break for very long generations
                if total_tokens > 4096 {
                    break;
                }
            }

            // Final done event
            let duration_ms = start.elapsed().as_millis() as i64;
            let _ = app.emit(&event_name, StreamEvent {
                session_id: req.session_id.clone(),
                chunk: String::new(),
                done: true,
                tokens_used: Some(total_tokens),
                duration_ms: Some(duration_ms),
            });
        }
    });

    LlamacppWorkerState { tx: Mutex::new(tx) }
}

fn fallback_prompt(messages: &[ChatMessage]) -> String {
    let mut prompt = String::new();
    for m in messages {
        prompt.push_str(&format!("{}: {}\n", m.role, m.content));
    }
    prompt.push_str("assistant: ");
    prompt
}
