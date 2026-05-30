# Tauri App Roadmap — Aetherium

Scope: `todo.md` tracks the Tauri app only. Swift/macOS work may differ and is not reflected here unless explicitly noted.

Legend: [x] Complete · [/] Partial · [ ] Not started

---

## 🔄 Core UX & Navigation
- [x] **Topic Management**: Full topic editing in WorkspaceSettingsView—view auto-detected topics, add custom topics, remove/blacklist topics to prevent regeneration.
- [ ] **Project Scratchpad**: A persistent per-project markdown canvas/note for manual dumping of context that remains visible or easily accessible during chat.
- [/] **Unified 'Source' model**: Migrated Documents and Web Captures to a single `sources` table. (Backend complete; specialized views still being phased out).
- [ ] **Onboarding tooltips**: First-run tour highlighting the sidebar, model selection, and workspace switcher.
- [ ] **Progress Indicators**: Real progress bars (not just boolean spinners) for embedding, large document imports, and graph rebuilds.
- [ ] **Configurable keyboard shortcuts**: UI to remap Quick Search and Command Palette triggers.
- [ ] **Bulk operations**: Expand multi-select session handling beyond the current "Move Sessions" dialog.

## 📈 Observability & System Health

- [ ] **Quick Search Performance**: Optimize debounce for users with >500 notes; currently too aggressive.
- [ ] **SQL Connection Pool**: Investigate increasing pool size (currently 10) to prevent "Database Busy" during intense background work (topic analysis + indexing).

## 🚀 AI & RAG Enhancements
- [/] **Adaptive Context Window**: Show an indicator of current chat token count vs. estimated window limits.
- [/] **Auto-summarization**: Generate 1-sentence summaries for documents/web captures on upload (DB field exists; automation pending).
- [/] **Recursive Semantic Search**: Pull in outbound `[[wiki-links]]` for highly relevant RAG results to expand discovery.
- [ ] **Audio Transcription**: Frontend for transcribing audio content via local STT models (e.g., Whisper).
- [ ] **Calendar Alarms**: Dedicated view for managing AI-triggered reminders (backend commands ready).
- [ ] **Sub-workspace AI containment**: A sub-workspace's content should not influence its parent's (or siblings') AI-derived state — topic signatures, suggested prompts, cross-workspace recommendations. Example: a "Sandbox" child under "Frontend" used for throwaway debugging shouldn't pollute Frontend's topic chips. Currently `collect_workspace_text` only reads `chat_sessions` directly scoped to the workspace_id, so messages already don't bleed up; the open question is whether cross-workspace recommendation queries (`services/topic_signature.rs` around the SELECT over all workspaces' `topic_signature`) should filter children out of a parent's "similar workspaces" set, and whether parent-level topic signatures should aggregate descendants at all. Needs its own design pass before implementation. NOT the same as a per-workspace "exclude from AI analysis" opt-out (considered and rejected — local-first already gives privacy, and a half-implemented opt-out would imply a guarantee we can't deliver without also gating RAG, semantic search, and document chunking).

## ⚡ Frontend Performance — Phase 2
- [ ] **H3 — Extract SessionSidebar from ChatView**: Pull the session list (the JSX block rendering grouped chat sessions, currently inline inside `ChatView.tsx`) into its own component subscribing only to `sessions` from `useChatStore`. The sidebar today re-renders on every message commit and every streaming tick because it lives inside `ChatView`'s render tree. After extraction, memoize the grouping logic. Render-scope fix first, memo second.
- [ ] **H4 — Memoize attachment processing**: Wrap `splitAttachmentIntoExcerpts`, `buildAttachmentContext`, and `buildWorkspaceDomainContext` (defined near the top of `ChatView.tsx`) in `useMemo` keyed on attachment identity. Instrument with `performance.mark` first to confirm cost. Only escalate to a Web Worker if a specific attachment size demonstrably blocks the main thread.
- [ ] **M7 — Stabilize ChatView effect deps**: Audit the `useEffect` that loads chat messages for the active session in `ChatView.tsx` (the one that depends on `activeChatId` plus several store-returned action wrappers). Stabilize unstable function references in its dependency array per the Effect Safety guidance in AGENTS.md.
- [ ] **M8 — Pagination defaults on folder/artifact list**: Add default `limit` parameters to `folder.list` and `artifact.list` — frontend wrappers in `src/lib/api.ts`, Rust commands in `src-tauri/src/commands/`, and the call sites in `ChatView.tsx`.

## ⚡ Backend Performance — Phase 2
- [x] **B1 — Dashboard recent_activity per-branch LIMIT**: Rewrite the `UNION ALL` in `get_dashboard_summary` (`src-tauri/src/commands/dashboard.rs`) so each branch has its own `ORDER BY updated_at DESC LIMIT 6` before the outer combine. Added supporting composite indices `idx_project_notes_workspace_updated`, `idx_concept_nodes_workspace_updated`, `idx_sources_workspace_updated` in `schema.sql`. `chat_sessions` is already covered by `idx_chat_sessions_active`. Indices on `source_chunks(source_id)` and `messages(session_id)` were already present.
- [ ] **B2 — Vector search index for embeddings**: SQLite vector search across `memory_embeddings` and `artifact_embeddings` is a full table scan today. Evaluate `sqlite-vec` (single extension, actively maintained, works with bundled rusqlite) once embedding count is a measured problem. Cost is loading the extension at pool init plus a schema migration to a virtual table — defer until profiling shows it.
- [ ] **B3 — `generate_summary` allocation review**: `services/ai_content_generator.rs::generate_summary` uses `.chars().collect()`. Likely there for grapheme-safe slicing, but worth profiling on long inputs. If it's only ever taking a bounded prefix, switch to `s.chars().take(n).collect()`. Wrap in `tokio::task::spawn_blocking` if any async caller hands it large input. Only act on this if profiling flags it.
- [ ] **B4 — Audit graph algorithm call sites for `spawn_blocking`**: PageRank and community detection in `services/graph_algorithms.rs` are CPU-bound. Grep all callers and confirm each async path wraps them in `tokio::task::spawn_blocking` — anything missing is a real bug (blocks the Tauri runtime and starves IPC).

## 🛠️ Technical Debt & Architecture
- [ ] **ChatView Componentization**: Refactor the 5k+ line `ChatView.tsx` into smaller, maintainable units: `MessageList`, `Composer`, `ChatSidebar`, and `GenerationStats`.
- [ ] **Api.ts Splitting**: Divide the 1.3k+ line monolithic IPC wrapper into domain-specific modules (e.g., `api.chat`, `api.workspace`, `api.system`).
- [ ] **Surgical FTS Triggers**: Optimize SQLite triggers to only update specific FTS rows on change, rather than full session re-indexing.
- [ ] **SQL Migrations**: Transition from monolithic `schema.sql` to a directory of versioned, incremental migration files.
- [ ] **Robust Stream Handling**: Refactor backend streaming to use stateful UTF-8 decoding to handle split multi-byte characters and JSON fragments reliably.

## 🛡️ Security & Privacy
- [ ] **Database Encryption**: Integrate SQLCipher or implement application-level encryption for content columns (currently stored in plaintext).
- [ ] **PIN Recovery flow**: Implement a "Mnemonic/Recovery Key" fallback or a secure "Reset App Data" flow on the PIN screen.
- [ ] **Secure JSON Extraction**: Replace substring-based extraction with a state machine to handle Markdown-wrapped AI responses more reliably.

## 📅 Data Lifecycle & Integrations
- [/] **Move projects between workspaces**: Drag-and-drop implementation for projects and orphaned sessions. (Notes/Sources migration pending).
- [ ] **Entity ownership logic**: Formalize rules for whether linked Notes/Docs move with a project or stay at the workspace root.


## 🎮 Demo Mode
- [ ] **"Try Demo" entry**: Allow jumping into demo mode from onboarding without requiring a PIN.
- [ ] **Scripted AI Mock**: Use a local mock service for AI responses to allow demo functionality without model downloads.

---


## 🐞 Known Issues
- [ ] **macOS PIN Lock Loop**: PIN screen re-appearing immediately if Touch ID is partially configured.
- [ ] **Flex Overflow**: Long file names can still break sidebar width in specific split-pane configurations.
- [ ] **Focus Drift**: Command Palette/Search Box closing sometimes scrolls the main window to the top on macOS.
- [ ] **Navigation Stalling**: Occasional view update failure when clicking a search result despite URL changes.
- [ ] **FTS Multi-word Tags**: Improved quoting needed for complex topic filters (Partially fixed).
no fit guidance for gemma 4 ✓
cpu status bar multicore
chat titles truncated unecessarily and missing a tooltip on hover
left click on icon to open search, right for menu ✓
scrolling chat to bottom hangs breifly jerky