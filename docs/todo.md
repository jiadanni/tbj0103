# Tauri App Roadmap — Aetherium

Scope: `todo.md` tracks the Tauri app only. Swift/macOS work may differ and is not reflected here unless explicitly noted.

Legend: [x] Complete · [/] Partial · [ ] Not started

---

## 🔄 Core UX & Navigation
- [x] **Topic Management**: Full topic editing in WorkspaceSettingsView—view auto-detected topics, add custom topics, remove/blacklist topics to prevent regeneration.
- [x] **Quick Search tray icon behavior**: Left-click opens search; right-click opens the menu.
- [ ] **Project Scratchpad**: A persistent per-project markdown canvas/note for manual dumping of context that remains visible or easily accessible during chat.
- [/] **Unified 'Source' model**: Migrated Documents and Web Captures to a single `sources` table. (Backend complete; specialized views still being phased out).
- [ ] **Onboarding tooltips**: First-run tour highlighting the sidebar, model selection, and workspace switcher.
- [ ] **Progress Indicators**: Real progress bars (not just boolean spinners) for embedding, large document imports, and graph rebuilds.
- [ ] **Configurable keyboard shortcuts**: UI to remap Quick Search and Command Palette triggers.
- [ ] **Bulk operations**: Expand multi-select session handling beyond the current "Move Sessions" dialog.
- [ ] **Chat title hover tooltips**: Chat titles truncate too aggressively in narrow sidebars; add title/tooltips so the full name is available on hover.

## 📈 Observability & System Health

- [ ] **Quick Search Performance**: Optimize debounce for users with >500 notes; currently too aggressive.
- [ ] **SQL Connection Pool**: Investigate increasing pool size (currently 10) to prevent "Database Busy" during intense background work (topic analysis + indexing).
- [ ] **Status bar CPU detail**: Add multi-core CPU visibility so the status bar can distinguish one saturated core from whole-system load.

## 🚀 AI & RAG Enhancements
- [x] **Model fit fallback guidance**: Avoid misleading "fits/doesn't fit" guidance for model names like `gemma4` that do not expose a parsable parameter size.
- [/] **Adaptive Context Window**: Show an indicator of current chat token count vs. estimated window limits.
- [/] **Auto-summarization**: Generate 1-sentence summaries for documents/web captures on upload (DB field exists; automation pending).
- [/] **Recursive Semantic Search**: Pull in outbound `[[wiki-links]]` for highly relevant RAG results to expand discovery.
- [ ] **Audio Transcription**: Frontend for transcribing audio content via local STT models (e.g., Whisper).
- [ ] **Calendar Alarms**: Dedicated view for managing AI-triggered reminders (backend commands ready).
- [ ] **Sub-workspace AI containment**: A sub-workspace's content should not influence its parent's (or siblings') AI-derived state — topic signatures, suggested prompts, cross-workspace recommendations. Example: a "Sandbox" child under "Frontend" used for throwaway debugging shouldn't pollute Frontend's topic chips. Currently `collect_workspace_text` only reads `chat_sessions` directly scoped to the workspace_id, so messages already don't bleed up; the open question is whether cross-workspace recommendation queries (`services/topic_signature.rs` around the SELECT over all workspaces' `topic_signature`) should filter children out of a parent's "similar workspaces" set, and whether parent-level topic signatures should aggregate descendants at all. Needs its own design pass before implementation. NOT the same as a per-workspace "exclude from AI analysis" opt-out (considered and rejected — local-first already gives privacy, and a half-implemented opt-out would imply a guarantee we can't deliver without also gating RAG, semantic search, and document chunking).
- [ ] **Stretch — Claude-style artifact canvas (model-emitted)**: Bring back a dedicated artifact panel, but driven by the model rather than a manual "save" button. Requires four pieces working together: (1) a system prompt instructing the chat model to wrap substantial standalone content in a structured tag like `<artifact id="..." title="..." type="..." language="...">...</artifact>`, with explicit framing for update-vs-create; (2) **grammar-constrained decoding** so the tag format is essentially never malformed — Ollama's JSON-mode `format` param for JSON-shaped artifacts, llama.cpp GBNF for XML-shaped (decide one wire format and commit); (3) a streaming parser that detects the open tag mid-stream and routes subsequent tokens into the panel instead of the message bubble, persisting on close tag; (4) an "open artifacts" context block injected into every turn (`Currently open artifact: id=..., content: ...`) so the model can update by id. Heuristic fallback: if a fenced code block ≥ N lines arrives without a wrapper, auto-promote per the old `artifactDetection.ts` rules. Feasibility note: local 14B-class models (Qwen 2.5 14B, Phi-4) handle structured emission and short-context updates well; 7B models break the format ~5–15% without grammar constraints and confuse create-vs-update ~20% of the time even with them, so this is gated on the user running ≥14B. Streaming + partial-tag parsing is the real engineering cost, not the model side. Only worth building if instrumentation on the existing `artifacts` table shows users actually want to iterate on saved content — until then, the tagged-note path (formerly "Save as Artifact", now "Save as Snippet") covers the one-shot save case. Backend (`artifacts` table, `commands::artifact::*`, `create_artifact_version`) is still registered and unused; this stretch goal would reuse it instead of building a parallel system.

## ⚡ Frontend Performance — Phase 2
- [ ] **H3 — Extract SessionSidebar from ChatView**: Pull the session list (the JSX block rendering grouped chat sessions, currently inline inside `ChatView.tsx`) into its own component subscribing only to `sessions` from `useChatStore`. The sidebar today re-renders on every message commit and every streaming tick because it lives inside `ChatView`'s render tree. After extraction, memoize the grouping logic. Render-scope fix first, memo second.
- [ ] **H4 — Memoize attachment processing**: Wrap `splitAttachmentIntoExcerpts`, `buildAttachmentContext`, and `buildWorkspaceDomainContext` (defined near the top of `ChatView.tsx`) in `useMemo` keyed on attachment identity. Instrument with `performance.mark` first to confirm cost. Only escalate to a Web Worker if a specific attachment size demonstrably blocks the main thread.
- [ ] **M7 — Stabilize ChatView effect deps**: Audit the `useEffect` that loads chat messages for the active session in `ChatView.tsx` (the one that depends on `activeChatId` plus several store-returned action wrappers). Stabilize unstable function references in its dependency array per the Effect Safety guidance in AGENTS.md.
- [ ] **M8 — Pagination defaults on folder/artifact list**: Add default `limit` parameters to `folder.list` and `artifact.list` — frontend wrappers in `src/lib/api.ts`, Rust commands in `src-tauri/src/commands/`, and the call sites in `ChatView.tsx`.
- [ ] **M9 — Chat autoscroll jank**: Scrolling to the bottom can briefly hang or feel jerky after new messages; profile the message list/minimap/scroll follow path before changing behavior.

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
- [/] **Real-snapshot migration upgrade test**: Capture tool + dormant CI workflow are in place. `cargo run --bin snapshot-db` (from `tauri/src-tauri/`) reads the live DB's schema version from `_migrations`, sanitizes content into `tauri/src-tauri/tests/snapshots/snapshot_vN.sqlite`, and exits idempotently. `.github/workflows/migration-upgrade.yml` runs on `workflow_dispatch` only and skips cleanly when there's no test file. Cadence: capture a snapshot *before* writing each new `vN_*` migration so CI has a fresh upgrade starting point. **Still pending:** (a) implement `tauri/src-tauri/tests/migration_upgrade.rs` — walk every `*.sqlite`, call `initialize_database`, assert all migrations end up in `_migrations`; (b) activate the workflow's `push`/`pull_request` triggers once the test exists; (c) keep `CONTENT_COLUMNS` in `src/bin/snapshot_db.rs` in sync as new content-bearing tables land.
- [ ] **Wrap each migration in a transaction**: Each `vN_*` block in `src-tauri/src/db/mod.rs` runs `conn.execute_batch(...)` directly. DML batches are implicitly transactional in SQLite, but multi-statement DDL is murkier — v71's `ALTER TABLE … RENAME` succeeded while downstream cleanup left a dangling `quick_search_chat_sessions_au` trigger, blocking startup until v73 was added to repair it. Audit whether `BEGIN; … INSERT INTO _migrations …; COMMIT;` around each block would make a half-failed migration self-rollback. Verify SQLite DDL-in-transaction semantics first (some DDL implicitly commits in other engines; SQLite is more forgiving but the edge cases need confirmation).
- [ ] **Prevent duplicate migration version numbers**: Two pairs of migrations share a number (`v26_thought_session_id` / `v26_sources_unification`; `v27_switch_workspace_to_chat` / `v27_sources_folder_tokens`) from parallel branches both grabbing the next free index. Harmless today because dispatch keys on the full name string, but it's a signal there's no "reserve a number" gate. Options: (a) switch to timestamp-prefixed names (`20260315120000_add_x`) so collisions are impossible, or (b) extend `tauri/scripts/lint-migrations.mjs` to fail when two entries in `ALL_MIGRATION_NAMES` share a numeric prefix.
- [ ] **Split `db/mod.rs` into per-migration files**: `db/mod.rs` is at 2700 lines with 75 migrations; each new one means scrolling past everything that came before and merge conflicts on `ALL_MIGRATION_NAMES` get more likely as devs work in parallel. Move each migration into its own file under `src-tauri/src/db/migrations/vN_*.rs`, with `mod.rs` reduced to a registry that lists them in order. Not urgent — defer until the file size actively bites during work.

## 🛡️ Security & Privacy
- [x] **Database Encryption**: SQLCipher integration with PIN-tied DEK wrapping (Argon2id KEK, AES-256-GCM, sidecar key-wrap file). Enable/disable stages a pending action that runs at next launch via a pre-DB unlock view. Default off. See `services/db_encryption.rs`, `commands/boot.rs`, `views/BootUnlockView.tsx`.
- [ ] **Biometric DEK in OS keychain**: macOS Keychain with `biometryCurrentSet` and Windows Hello via `KeyCredentialManager` to skip PIN typing on unlock. Linux remains PIN-only (no consistent biometric-gated secret store). Land alongside any unlock-flow polish.
- [ ] **PIN Recovery flow**: Implement a "Mnemonic/Recovery Key" fallback or a secure "Reset App Data" flow on the PIN screen. With DB encryption enabled, losing the PIN means losing the data — recovery becomes load-bearing.
- [ ] **Private object-level sync (long-term stretch)**: Replace raw app-data / SQLite-file Git sync with encrypted object-level sync. Keep SQLite as the local source of truth, but sync row-level records or append-only events for notes, chat sessions, messages, memories, settings, and sidecar files through a small private relay or encrypted object store. Avoid syncing `aetherium.db` directly; design conflict handling around stable IDs, `updated_at`, tombstones, device IDs, and per-entity merge rules.
- [ ] **Secure JSON Extraction**: Replace substring-based extraction with a state machine to handle Markdown-wrapped AI responses more reliably.

## 📅 Data Lifecycle & Integrations
- [/] **Move projects between workspaces**: Drag-and-drop implementation for projects and orphaned sessions. (Notes/Sources migration pending).
- [ ] **Entity ownership logic**: Formalize rules for whether linked Notes/Docs move with a project or stay at the workspace root.


## 🎮 Demo Mode
- [ ] **"Try Demo" entry**: Allow jumping into demo mode from onboarding without requiring a PIN.
- [ ] **Scripted AI Mock**: Use a local mock service for AI responses to allow demo functionality without model downloads.

---


## 🧹 Dead Schema & Zombie Features (Audit 2026-06-07)

Empty-table audit of the live DB (`aetherium.db`) revealed tables with no rows in production. Categorized by code-path status (`grep -rEi "INSERT INTO <table>" src-tauri/src`).

**Dead schema (zero reads, zero writes — drop candidates):**
- [ ] **Remove `learning_paths` table**: 0 inserts, 0 selects in Rust backend. Migration shipped, feature never wired or already removed. Confirm no frontend TS references before dropping.
- [ ] **Remove `path_milestones` table**: 0 inserts, 0 selects. Same status as `learning_paths` — likely paired feature.

**Zombie reads (selects with no inserts — silent empty results in UI):**
- [ ] **`citations` table read but never written**: 0 inserts, 2 selects. Citation pipeline missing producer; consumers return empty arrays silently.
- [ ] **`audio_transcriptions` table read but never written**: 0 inserts, 2 selects. Same pattern.

**Broken producers (insert sites exist but zero rows in prod — likely runtime bugs):**
- [ ] **RAG ingestion not landing rows**: `sources` (12 insert sites) and `source_chunks` (8 insert sites) are empty despite being core to RAG. Trace ingestion: IPC handler → service → SQLite write. Verify command is in `generate_handler![…]` and that the UI upload path actually invokes it.
- [ ] **`artifacts` empty but heavily read**: 2 insert sites, 14 select sites. Strong signal that consumers expect data the producer never delivers.
- [ ] **`artifact_embeddings` empty**: 1 insert site, depends on `artifacts` producer above.
- [ ] **`document_chunks` empty**: 1 insert site, 3 selects. Likely tied to broken `sources` ingestion.
- [ ] **`uploaded_documents` empty**: 1 insert site, 3 selects. Verify upload IPC fires end-to-end.
- [ ] **`web_captures` empty**: 1 insert site, 5 selects. Web-capture save path needs runtime trace.
- [ ] **`concept_mentions` empty**: 5 insert sites, 10 selects. Knowledge graph extraction is not running on chat/notes.
- [ ] **`concept_change_proposals` empty**: 4 insert sites, 7 selects. Concept-edit proposal flow not firing.
- [ ] **`graph_statistics` empty**: 3 insert sites, 5 selects. Graph stats job not running or not persisting.
- [ ] **`flashcard_topics` empty**: 1 insert, 12 selects. Flashcard topic creation broken; UI almost certainly reads empty arrays.
- [ ] **Quiz subsystem dark**: `quizzes` (1 insert, 3 selects), `quiz_questions` (1 insert, 2 selects), `quiz_answers` (1 insert, 5 selects). Quiz generation pipeline never produces output.
- [ ] **`calendar_alarms` empty**: 1 insert, 4 selects. Calendar alarm creation path not exercised.
- [ ] **`note_templates` empty**: 1 insert, 6 selects. Template creation UI may be missing or unwired.

**Repro recipe per row:** trigger the feature in the UI, open DevTools, watch for the corresponding `invoke` call and the matching `[ipc]` log line. If `invoke` rejects with "Command not found" → step 3 of the Tauri Command Registration checklist was skipped. If it resolves but no row lands → the handler is silently swallowing an error; instrument and re-run.

---

## 🐞 Known Issues
- [ ] **macOS PIN Lock Loop**: PIN screen re-appearing immediately if Touch ID is partially configured.
- [ ] **Flex Overflow**: Long file names can still break sidebar width in specific split-pane configurations.
- [ ] **Focus Drift**: Command Palette/Search Box closing sometimes scrolls the main window to the top on macOS.
- [ ] **Navigation Stalling**: Occasional view update failure when clicking a search result despite URL changes.
- [ ] **FTS Multi-word Tags**: Improved quoting needed for complex topic filters (Partially fixed).
