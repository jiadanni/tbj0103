# Aetherium Codebase Analysis Report

This report summarizes the findings of a comprehensive audit of the Aetherium repository, focusing on the Rust backend, SQLite schema, and frontend architecture.

## 1. Bugs & Logic Issues

### Critical: UTF-8 Streaming Fragility
In `tauri/src-tauri/src/ollama/client.rs`, the `stream_with_prefix` function attempts to convert each raw chunk to a UTF-8 string:
```rust
let text = std::str::from_utf8(&chunk).map_err(|e| format!("UTF-8 error: {e}"))?;
```
> [!CAUTION]
> If a multi-byte UTF-8 character is split across two network chunks, `from_utf8` will fail, causing the entire chat stream to terminate abruptly.

### Logic: JSON Line Fragmentation
The backend assumes each line in the Ollama stream is a complete JSON object. If Ollama emits a large response or network buffering splits a JSON line, `serde_json::from_str` will fail.

### Logic: Brittle JSON Extraction
The `extract_json_array` function in `ollama.rs` used for follow-up questions and topic extraction is simplistic:
```rust
fn extract_json_array(s: &str) -> String {
    if let (Some(start), Some(end)) = (s.find('['), s.rfind(']')) {
        s[start..=end].to_string()
    } else {
        "[]".to_string()
    }
}
```
> [!WARNING]
> This will fail or return invalid data if the model's response contains multiple Markdown code blocks with JSON arrays, or if the model prefixes the response with text containing a bracket.

---

## 2. Performance Concerns

### FTS Trigger Overhead
The `schema.sql` contains aggressive FTS5 triggers (e.g., `quick_search_chat_sessions_au`). On any update to a session title, it deletes and re-inserts *all* related messages, artifacts, and summaries into the search index.
> [!IMPORTANT]
> As a user's history grows to thousands of messages, renaming a chat session or moving it between projects will become exponentially slower and could block the DB connection pool.

### Monolithic File Bloat
*   **`ChatView.tsx` (5125 lines)**: This is a significant maintenance and performance risk. React's reconciliation and component mounting will suffer.
*   **`api.ts` (1346 lines)**: Contains all IPC wrappers, interfaces, and observability logic.

### SQLite Connection Pool
The pool is limited to 10 connections. Given the heavy background work (topic signature recomputation, quick search indexing, memory processing), the UI might experience "Database Busy" errors during intense background activity.

---

## 3. Security Vulnerabilities

### Plaintext Storage
While there is a "Chat Encryption" feature mentioned, the primary SQLite database (`db.sqlite`) appears to store message content, summaries, and notes in plaintext.
> [!CAUTION]
> Physical access to the machine allows anyone to read the entire chat history by opening the SQLite file.

### Localhost Binding
The `OllamaClient` hard-restricts the base URL to `localhost`. While secure, it prevents users from using a more powerful secondary machine on their LAN for inference without modifying the source code.

---

## 4. Code Quality & Maintenance

### Duplicated Logic
IPC observability thresholds (defining what constitutes a "slow" request) are defined in both `tauri/src/lib/api.ts` and `tauri/src-tauri/src/commands/ollama.rs`.

### Schema Complexity
`schema.sql` is nearly 1000 lines. Changes to one table frequently require scrolling through hundreds of lines of unrelated trigger logic.

---

## Suggested Improvements

### Short-Term (Stability)
1.  **Refactor Streaming**: Use a buffered reader or a stateful UTF-8 decoder in the Rust backend to handle split characters and JSON fragments.
2.  **Robust JSON Parsing**: Replace the substring-based JSON extraction with a more robust regex or state machine that handles Markdown blocks.

### Mid-Term (Performance)
1.  **Surgical FTS**: Refactor triggers to only update the specific rows that changed, rather than blowing away the entire session's index.
2.  **Componentize `ChatView`**: Split into `ChatHistorySidebar`, `MessageList`, `Composer`, and `ChatHeader`.

### Long-Term (Architecture)
1.  **SQL Migrations**: Transition from a monolithic `schema.sql` to a directory of versioned migration files.
2.  **Database Encryption**: Consider SQLCipher or application-level encryption for the `content` columns.
