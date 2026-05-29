# Aetherium Architecture

This document describes the technical architecture of Aetherium, a local-first AI learning companion.

Two parallel implementations exist: a Swift/macOS app and a Tauri cross-platform app. The **Tauri app is the active development target**. The Swift app is maintained for reference but is not receiving new features.

---

## Design Principles

1. **Privacy First** — all data stored locally; local models (Ollama/llama.cpp/MLX) preferred over cloud APIs; no telemetry.
2. **Workspace-Centric Organization** — hierarchical workspaces → projects → chat sessions → messages. Knowledge graph, notes, flashcards, and documents all scoped to a workspace.
3. **Multi-Provider Inference** — Ollama, embedded llama.cpp, MLX (macOS), and web-based AI (Playwright bridge) are all first-class providers.
4. **Background Intelligence** — async background scheduler handles memory extraction, summarization, topic signature computation, and git sync without blocking user interactions.

---

## Tauri App

### Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript (strict mode), Tailwind CSS v3 |
| State | Zustand 4 (4 stores) |
| Routing | React Router v6 (`BrowserRouter`) |
| IPC | Tauri v2 `invoke()` — all wrappers in `tauri/src/lib/api.ts` |
| Backend | Rust (Tauri v2), `tokio` async runtime |
| Database | SQLite via `rusqlite` + `r2d2_sqlite` connection pool |
| FTS | SQLite FTS5 (`quick_search_documents_fts`, unicode61, diacritics stripped) |
| Local AI | Ollama HTTP client; optional embedded llama.cpp (feature-gated); MLX HTTP (macOS) |
| Web AI | Playwright browser automation (ChatGPT, Claude, Gemini, DeepSeek) |

### High-Level Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                    Aetherium Tauri App                        │
├───────────────────────────┬──────────────────────────────────┤
│  React + TypeScript       │  Rust / Tauri v2                 │
│  Frontend                 │  Backend                         │
│                           │                                  │
│  ┌───────────┐            │  ┌──────────────────────────┐   │
│  │  Views    │  invoke()  │  │  Commands (thin layer)   │   │
│  │  (25+ pages)◄─────────►│  │  (one file per domain)   │   │
│  └───────────┘            │  └────────────┬─────────────┘   │
│  ┌───────────┐            │               │                  │
│  │  Stores   │            │  ┌────────────▼─────────────┐   │
│  │  (Zustand)│            │  │  Services (business logic)│   │
│  └───────────┘            │  │  • topic_signature        │   │
│  ┌───────────┐            │  │  • memory_pipeline        │   │
│  │  api.ts   │            │  │  • context_assembler      │   │
│  │  (typed   │            │  │  • background_scheduler   │   │
│  │   IPC)    │            │  │  • document_processor     │   │
│  └───────────┘            │  │  • quick_search_service   │   │
│                           │  └────────────┬─────────────┘   │
│                           │               │                  │
│                           │  ┌────────────▼─────────────┐   │
│                           │  │  SQLite (rusqlite/r2d2)   │   │
│                           │  │  schema.sql               │   │
│                           │  └──────────────────────────┘   │
└───────────────────────────┴──────────────────────────────────┘
        │                                  │
        ▼                                  ▼
  ┌───────────┐                    ┌──────────────┐
  │  Ollama   │   llama.cpp MLX    │  SQLite DB   │
  │ :11434    │   (embedded/local) │  (on-disk)   │
  └───────────┘                    └──────────────┘
```

---

### Frontend

#### Routes (`tauri/src/App.tsx`)

All routes are nested under the authenticated `Layout` shell:

| Route | View |
|---|---|
| `/` | redirect → `/chat` |
| `/chat` | `ChatView` (new session) |
| `/chat/:id` | `ChatView` (existing session) |
| `/notes` | `DailyNotesView` |
| `/notes/:id` | `NoteEditorView` |
| `/memory` | `MemoryView` |
| `/sources` | `SourceBrowserView` |
| `/documents` | `DocumentBrowserView` |
| `/graph` | `KnowledgeGraphView` |
| `/flashcards` | `FlashcardReviewView` |
| `/thoughts` | `ThoughtQueueView` |
| `/webcapture` | `WebCaptureView` |
| `/preferences` | `PreferencesView` |
| `/recycle-bin` | `RecycleBinView` |
| `/logs` | `LogsView` |
| `/history` | `HistoryView` |
| `/learning-path` | `LearningPathView` |
| `/plugins` | `PluginManagerView` |
| `/dashboard` | `ProjectDashboardView` |
| `/workspace-settings` | `WorkspaceSettingsView` |
| `/auth` | `AuthenticationView` |

`MenuEventHandler` listens to Tauri `menu-navigate` and `menu-action` events (native menu bar) and to `app:navigate-target` (Quick Search result opens).

#### Views (`tauri/src/views/`)

| File | Purpose |
|---|---|
| `AuthenticationView.tsx` | Auth barrier (PIN/biometric); blocks access until authenticated |
| `ChatView.tsx` | Primary chat interface — virtualized message list (`react-virtuoso`), composer with `[[wiki-link]]` autocomplete, model picker, dual-model, incognito, split-pane aware, artifact side-panel |
| `DailyNotesView.tsx` | Daily journal with mood/productivity tracking |
| `NoteEditorView.tsx` | Markdown note editor with `[[wiki-link]]` support and backlink panel |
| `MemoryView.tsx` | AI memory management — view, pin, delete cross-session facts/preferences |
| `SourceBrowserView.tsx` | Unified browser for documents and web captures; processing status, folder grouping |
| `DocumentBrowserView.tsx` | Legacy document browser (data unified into `sources` table) |
| `KnowledgeGraphView.tsx` | Force-directed interactive knowledge graph |
| `FlashcardReviewView.tsx` | SM-2 spaced-repetition flashcard review sessions |
| `ThoughtQueueView.tsx` | Deferred AI thought queue — scheduled background processing |
| `WebCaptureView.tsx` | Capture and save web pages with full content extraction |
| `PreferencesView.tsx` | Full settings UI; also renders standalone in the `preferences.html` webview entry point |
| `RecycleBinView.tsx` | Soft-deleted sessions with restore and hard-delete |
| `LogsView.tsx` | Structured app log viewer (level/source/timestamp filtering) |
| `HistoryView.tsx` | Browsable activity history |
| `LearningPathView.tsx` | Ordered milestones with completion tracking |
| `PluginManagerView.tsx` | MCP server manager — enable, configure, list tools/resources |
| `ProjectDashboardView.tsx` | Per-workspace landing: recent activity, goals, review stats, suggestions |
| `WorkspaceSettingsView.tsx` | Edit workspace identity, icon, parent, prompt instructions, topic-signature tags |
| `ImportSettingsSection.tsx` | Import chats from LM Studio, Claude Desktop, Gemini Takeout |
| `BackupSettingsSection.tsx` | DB backup scheduling and restore |

#### Components (`tauri/src/components/`)

| File | Purpose |
|---|---|
| `Layout.tsx` | Root shell: sidebar + main content + preferences dock button |
| `Sidebar.tsx` | Primary nav: workspace switcher, nav items, preferences pop-out |
| `SplitPaneLayout.tsx` | Two-pane split-view container; wraps each pane in `WorkspacePaneProvider` |
| `ChatMessageBubble.tsx` | Message bubble — Markdown, copy, regenerate, token/speed info |
| `ArtifactPanel.tsx` | Slide-in panel for code/document/diagram artifacts; versioning UI |
| `CommandPalette.tsx` | `Ctrl+K` / `⌘K` command palette |
| `StatusBar.tsx` | Bottom bar: live CPU %, RAM, GPU VRAM via `get_performance_stats` polling |
| `WindowControls.tsx` | Linux-only window chrome: minimize/maximize/close + `startDragging()` |
| `ContextIndicator.tsx` | Shows which context sources (memories, docs, summaries) are in the next message |
| `WorkspaceMigrationBanner.tsx` | Topic-signature-driven suggestion to move a chat to a better workspace |
| `SmartTextEditor.tsx` | Textarea with `[[wiki-link]]` and `@-mention` autocomplete |
| `TopicChips.tsx` | Workspace topic-signature domain tags rendered as chips |
| `SelectionToolbar.tsx` | Floating toolbar on text selection (copy, quote, define) |

#### Zustand Stores (`tauri/src/stores/`)

| Store | Key State | Notes |
|---|---|---|
| `workspaceStore.ts` | `workspaces`, `activeWorkspaceId`, `splitMode`, `panes: { primary, secondary }` (each: `workspaceId`, `projectId`, `view`, `noteSelection`) | Drives split-pane isolation |
| `chatStore.ts` | `sessions`, `messages` (keyed by sessionId), `activeChatId`, `streamingSessionId`, `streamingContent`, dual-model refine state, `pendingPromptText` | SSE streaming state |
| `settingsStore.ts` | All user preferences (model, theme, accent, fontSize, sidebar width, dual-model config, etc.) | Persisted via Zustand `persist` → `localStorage` |
| `artifactStore.ts` | `artifacts`, `activeArtifact`, panel open/closed | Artifact CRUD + versioning |

#### Lib Utilities (`tauri/src/lib/`)

| File | Purpose |
|---|---|
| `api.ts` | All typed `invoke()` IPC wrappers; `invokeObserved()` — request IDs, timing, slow-response logging (15s threshold for AI, 5s default); frontend model-list cache (30s TTL) |
| `workspacePane.tsx` | `WorkspacePaneProvider`, `useScopedWorkspace`, `useScopedChat`, `useScopedProjects` — stable-identity pane-scoped hooks |
| `prefsWindowMode.ts` | `usePrefsWindowMode()` + `getPrefsWindowSingleInstance()` — single/multi-instance preferences window toggle |
| `modelGroups.ts`, `modelRoles.ts`, `modelSizing.ts` | Model grouping, role-tag definitions, parameter-count parsing for auto-selection |
| `artifactDetection.ts` | Detect artifact blocks in streamed response text |
| `composerSuggestions.ts` | Typeahead suggestions from chat/workspace context |

---

### Backend

#### Command Files (`tauri/src-tauri/src/commands/`)

Commands are thin: validate input, acquire DB connection, call a service, return `Result<T, String>`.

| File | Domain |
|---|---|
| `workspace.rs` | Workspace CRUD, hierarchy, icon, hide/unhide, topic signature |
| `project.rs` | Project CRUD, move to workspace, stats |
| `chat.rs` | Session CRUD, soft-delete/restore, move, batch-move, message variants, token usage, recycle bin |
| `ollama.rs` | `send_message` (SSE streaming), `send_dual_model_message`, model listing, title generation, prompt polish, embedding, follow-ups, `stop_stream`; also manages `BackgroundInferenceCancel` for preemption |
| `mlx.rs` | `send_mlx_message`, `list_mlx_models` (macOS Apple Silicon) |
| `llamacpp.rs` | `send_llamacpp_message`, `stop_llamacpp_stream`, `list_llamacpp_models` (feature-gated) |
| `web_ai.rs` | `send_web_message` — Playwright bridge for ChatGPT/Claude/Gemini/DeepSeek |
| `context.rs` | RAG context assembly + forward to Ollama |
| `search.rs` | Semantic search (embedding + cosine sim), keyword FTS5 search |
| `quick_search.rs` | Quick-search window IPC: show/hide, FTS query, open result, mark-main-window-ready |
| `note.rs` | Notes, daily notes, templates, backlinks, outbound links |
| `knowledge_graph.rs` | Concept nodes/links, graph stats, learning path, concept extraction |
| `flashcard.rs` | SM-2 flashcards: create, list due, review, generate from AI, extract from content |
| `learning_goal.rs` | Learning goal CRUD |
| `artifact.rs` | Artifact CRUD, versioning, search |
| `summary.rs` | Conversation summaries (rolling/segment/final) |
| `document.rs` | Upload, list, process documents (legacy; unified into `sources`) |
| `source.rs` | Unified source CRUD and processing |
| `memory.rs` | Cross-session AI memory CRUD, extraction |
| `mcp.rs` | MCP server management, tool listing, tool call, resource read |
| `thought_queue.rs` | Deferred thought items CRUD |
| `export.rs` | Markdown, JSON, Obsidian vault export |
| `backup.rs` | DB backup create/list/restore/delete |
| `settings.rs` | App settings key-value CRUD |
| `system.rs` | `get_system_specs`, `get_performance_stats`, `open_preferences_window` |
| `security.rs` | PIN passcode and biometric authentication |
| `ai_model.rs` | AI model registry, token usage recording, speed stats |
| `topic_signature.rs` | Get/regenerate/update workspace topic signature, check workspace match |
| `web_capture.rs` | Web capture CRUD |
| `chat_file.rs` | JSON file persistence, encryption, import from LM Studio/Claude/Gemini |
| `chat_conversion.rs` | AI-assisted conversion of chat to note or source document |
| `git_sync.rs` | Vault git sync status, configure, trigger |
| `alarm.rs` | Calendar alarms CRUD |
| `log.rs` | Structured log viewer IPC |
| `demo.rs` | Demo mode activate/deactivate |
| `graph.rs` | PageRank, shortest path, community detection |
| `dashboard.rs` | Aggregated workspace dashboard payload |

#### Services (`tauri/src-tauri/src/services/`)

| File | Purpose |
|---|---|
| `background_scheduler.rs` | 30s async tick: memory pipeline, rolling summarization, git sync; skips when user is streaming |
| `topic_signature.rs` | Heuristic word-frequency pass + optional Ollama enrichment; exports `recompute_workspace_signature_with_ai(cancel_rx)` for cancelable background runs |
| `memory_pipeline.rs` | Scans recent chats, extracts AI memories, writes to `memories` table |
| `context_assembler.rs` | RAG context assembly: fetches memories, document chunks, summaries; respects token budget |
| `summarization_service.rs` | Rolling, segment, and final conversation summaries via Ollama |
| `document_processor.rs` | Splits documents into chunks, generates embeddings via Ollama `/api/embed` |
| `quick_search_index.rs` | On startup, ensures `quick_search_documents` is fully populated |
| `quick_search_service.rs` | Executes FTS5 queries, returns BM25-ranked results |
| `retrieval_engine.rs` | Cosine similarity search over `source_chunks.embedding` BLOBs |
| `semantic_search.rs` | Embedding generation + retrieval engine orchestration |
| `concept_extractor.rs` | NLP concept extraction for knowledge graph |
| `graph_algorithms.rs` | PageRank, BFS shortest path, Louvain community detection |
| `chat_file_store.rs` | JSON per-session file persistence with optional AES-256 encryption |
| `link_parser.rs` | Parses `[[wiki-link]]` syntax from note content |
| `linking_engine.rs` | Maintains `note_links` backlink index on note save |
| `spaced_repetition.rs` | SM-2 algorithm for flashcard interval/ease-factor updates |
| `export_engine.rs` | Markdown, JSON, and Obsidian vault export |
| `backup_service.rs` | Timestamped `.zip` snapshots of DB + chat files |
| `git_sync.rs` | Syncs vault to a configured remote Git repository |
| `artifact_service.rs` | Detects and extracts artifact blocks from streamed LLM content |
| `chat_conversion.rs` | AI-assisted conversion of chat sessions into notes or source documents |

#### Ollama Client (`tauri/src-tauri/src/ollama/client.rs`)

- `OllamaClient { base_url, http: &'static Client }` — shares a single `reqwest::Client` pool (`SHARED_HTTP_CLIENT`)
- **`MODEL_CACHE`** — process-level `Mutex<Option<CachedModels>>`, 30s TTL, keyed by `base_url`; caches `/api/tags`
- **`CAPABILITY_CACHE`** — per `(base_url, model_name)` entry, 10-minute TTL; caches `/api/show` capability data (cold load: 20–50s per model)
- `RequestContext { request_id, source, session_id, model, stream, timeout_override }` — per-request observability + optional duration override (background topic signature: 90s cap)
- `stream_message_observed()` — SSE streaming → emits `ollama-stream-{session_id}` Tauri events
- `invalidate_model_cache()` — clears both `MODEL_CACHE` and `CAPABILITY_CACHE`

#### Rust Models (`tauri/src-tauri/src/models/`)

| File | Key Structs |
|---|---|
| `workspace.rs` | `Workspace`, `TopicSignature`, `TopicTag` |
| `chat.rs` | `ChatSession`, `Message`, `MessageRole` |
| `project.rs` | `Project` |
| `knowledge_graph.rs` | `ConceptNode`, `ConceptLink`, `GraphStatistics` |
| `learning_card.rs` | `LearningCard` (SM-2: `ease_factor`, `interval`, `repetitions`, `next_review_date`) |
| `learning_goal.rs` | `LearningGoal` (progress 0.0–1.0) |
| `artifact.rs` | `Artifact`, `ArtifactSummary` |
| `note.rs` | `ProjectNote`, `DailyNote`, `NoteTemplate` |
| `summary.rs` | `ConversationSummary` (type: rolling/segment/final, embedding BLOB) |
| `memory.rs` | `Memory` (type: fact/preference/context; scope: global/workspace) |
| `mcp.rs` | `MCPServer`, `MCPTool`, `MCPResource` |
| `ai_model.rs` | `AiModel` (provider, role_tags), `ModelSpeedStat` |
| `dashboard.rs` | `DashboardSummary` and all sub-structs |
| `system.rs` | `SystemSpecs`, `PerformanceStats` |

---

### SQLite Schema (`tauri/src-tauri/src/schema.sql`)

The schema is the single source of truth. All `CREATE TABLE` statements use `IF NOT EXISTS`; migrations are additive.

**Core tables:**

| Table | Purpose |
|---|---|
| `workspaces` | Top-level containers; `topic_signature` (JSON), `parent_workspace_id` (self-ref hierarchy), `is_hidden` |
| `projects` | Sub-containers within a workspace |
| `chat_sessions` | Conversations; soft-delete (`is_deleted`, `deleted_at`), incognito, branching (`parent_session_id`) |
| `messages` | Role-typed (user/assistant/system); `variant_group_id` for A/B generations |
| `citations` | Source citations per message |

**Knowledge:**

| Table | Purpose |
|---|---|
| `concept_nodes` | Knowledge graph nodes (type, x/y position, `hierarchy_level`) |
| `concept_links` | Directed edges (related/part_of/prerequisite/contradicts/supports/example), strength 0–1 |
| `concept_mentions` | Cross-reference: concept ↔ source |
| `graph_statistics` | Cached per-workspace graph metrics |
| `learning_goals`, `learning_cards`, `learning_paths`, `path_milestones` | SM-2 flashcards, goals, milestones |

**Notes:** `project_notes`, `daily_notes` (unique per workspace+date, mood/productivity), `note_templates`, `note_links` (backlink index)

**Sources & RAG:**

| Table | Purpose |
|---|---|
| `sources` | Unified document + web-capture table (`source_type`, `folder`, `token_count`) |
| `source_chunks` | Chunked text with `embedding BLOB` |
| `uploaded_documents`, `document_chunks`, `web_captures` | Legacy tables; data migrated to `sources`/`source_chunks` on schema load |

**AI / Memory:**

| Table | Purpose |
|---|---|
| `memories` | Cross-session facts/preferences/context (scope: global/workspace) |
| `ai_models` | Provider registry with role_tags, token usage |
| `conversation_summaries` | Type: rolling/segment/final; `embedding BLOB` |
| `artifacts` | Code/doc/diagram/config/data; versioned via `parent_artifact_id` |
| `artifact_embeddings`, `memory_embeddings` | Embedding BLOBs for similarity search |

**Infrastructure:**

| Table | Purpose |
|---|---|
| `settings` | Flat key-value (~30 defaults seeded on first run) |
| `thought_queue` | Deferred AI items (status: pending/scheduled/processing/done) |
| `quick_search_documents` | Denormalized index for FTS |
| `quick_search_documents_fts` | FTS5 virtual table (unicode61, remove_diacritics=1) |
| `calendar_alarms` | Scheduled reminders |

**FTS triggers** (surgical, guarded by `WHEN` clauses):
- `quick_search_chat_sessions_ai/ad/au` — handles create, delete, soft-delete/restore, title rename, and project move as separate targeted `UPDATE`/`INSERT`/`DELETE` cases; no full-table scans for metadata-only updates
- `quick_search_messages_ai/au/ad`, `quick_search_artifacts_ai/au/ad`, `quick_search_memories_ai`
- `quick_search_documents_au` — only fires when an FTS-indexed column (`title`, `subtitle`, `body`) changes

---

### Key Architecture Patterns

#### Split-Pane System
- `SplitPaneLayout` renders primary and secondary `WorkspacePaneProvider` side by side
- `workspaceStore.panes` holds independent state (`workspaceId`, `projectId`, `view`) for each pane
- `useScopedWorkspace()`, `useScopedChat()`, `useScopedProjects()` in `workspacePane.tsx` dispatch only to the correct pane — stable function identity prevents render loops

#### Background Inference Preemption
- `BackgroundInferenceCancel` is a `tokio::sync::watch::Sender<u64>` generation counter in Tauri app state
- `send_message` and `send_dual_model_message` bump the counter before touching Ollama
- Background topic-signature inference uses `tokio::select!` to race the `/api/chat` future against the cancel signal — on bump, the HTTP connection is torn down and Ollama is freed immediately

#### Multi-Provider Inference

| Provider | Mechanism | Feature flag | Commands |
|---|---|---|---|
| Ollama | HTTP to local `ollama` | Always on | `send_message`, `send_dual_model_message` |
| llama.cpp | Embedded worker thread | `llamacpp` | `send_llamacpp_message` |
| MLX | HTTP to local `mlx_lm` | macOS only | `send_mlx_message` |
| Web AI | Playwright browser automation | Always on | `send_web_message` |

GPU acceleration for llama.cpp is selected at build time via `--features llamacpp-cuda` (NVIDIA), `llamacpp-rocm` (AMD Linux), or `llamacpp-vulkan` (Intel / cross-platform). Each backend uses a platform-gated dep alias so macOS Metal builds are unaffected.

#### Dual-Model Chat
- Draft model generates an initial response; refine model polishes it
- Modes: `serial` (refine waits for draft) or `parallel` (race then merge)
- Frontend streaming shows both phases in real time via separate SSE events

#### Quick-Search Window
- Created at startup: borderless, always-on-top, skip-taskbar `WebviewWindow` labeled `quick-search`
- Triggered by configurable global shortcut (default `Ctrl+Shift+K`) and tray icon menu
- FTS5 query → BM25 + recency-ranked results

#### Dedicated Preferences Window
- Standalone Vite entry: `preferences.html` → `src/preferences/main.tsx` → `PreferencesView` in a `MemoryRouter`
- `open_preferences_window(single_instance: bool)` Rust command:
  - `single_instance=true`: focuses existing `preferences-*` window
  - `single_instance=false`: creates a new `preferences-<timestamp>` window
- Keyboard shortcut: `Ctrl+Shift+,`; also reachable from Layout dock and Sidebar pop-out

#### Background Scheduler
- 30s `tokio` tick loop (`background_scheduler.rs`)
- Skips if previous tick is still running, user is actively streaming, or a chat was accessed within 5 minutes
- Tasks: memory pipeline extraction, rolling conversation summarization, git sync (every N-th tick)

#### Topic Signature System
- Each workspace stores a JSON `topic_signature` (domain tags with frequency weights + manual/ignored overrides)
- Heuristic pass: TF-IDF-style word frequency over recent messages
- Optional Ollama enrichment: sends tag candidates to background model for semantic refinement; cancelable via `cancel_rx`
- Powers `WorkspaceMigrationBanner` — suggests better workspace for off-topic chats

#### IPC Observability (`api.ts`)
- Every `invoke()` goes through `invokeObserved()`: request ID, timing, slow-response warnings (15s for AI calls, 5s default), structured JSON error logs
- Active only in dev mode (`http:`/`https:` protocol)

#### Linux Window Management
- Drag regions require both `data-tauri-drag-region` attribute **and** `onDragRegionMouseDown` handler (calls `getCurrentWindow().startDragging()`)
- `WindowControls` renders minimize/maximize/close only on Linux; uses explicit `isMaximized()` check, not `toggleMaximize()`
- Window position/size/maximized state persisted to `settings` table on move/resize/close

---

### Data Flow: User Sends a Message

```
1. User types in ChatView composer
2. ChatView calls api.chat.addMessage() → Rust 'add_message' command
   → Message saved to SQLite immediately
3. ChatView calls api.ollama.sendMessage() → Rust 'send_message' command
   a. BackgroundInferenceCancel counter incremented (preempts background tasks)
   b. Context assembled by context_assembler (memories + doc chunks + summaries)
   c. OllamaClient.stream_message_observed() → SSE to Ollama
4. Ollama streams back tokens
   → Tauri emits 'ollama-stream-{session_id}' events to frontend
   → chatStore.streamingContent updated on each event
5. On stream end: assistant message saved to SQLite
6. Background: background_scheduler (next tick) may run memory extraction
   and/or rolling summarization on the updated session
```

---

## Swift App (macOS — reference implementation)

The Swift app shares the same feature concepts but uses different primitives. It is **not** receiving new features.

### Tech Stack

| Layer | Technology |
|---|---|
| UI | SwiftUI |
| Persistence | SwiftData (SQLite-backed, Core Data successor) |
| Authentication | LocalAuthentication (Touch ID / Face ID / Optic ID) |
| AI | OllamaService (HTTP), ModelOrchestrator |

### Key Views

- `AuthenticationView` — biometric lock screen
- `ContentView` — three-column `NavigationSplitView` (projects → sessions → chat)
- `ChatView` — message list, input field, model switcher

### Key Services

- **`OllamaService`** — HTTP client for Ollama `/api/tags`, `/api/chat`, `/api/generate`
- **`SecurityManager`** — biometric authentication, auto-lock
- **`ModelOrchestrator`** — local vs. cloud model selection; simple token estimation (~4 chars/token)

### Swift Data Models

- `AetheriumProject` — top-level container; one-to-many with `ChatSession` and `LearningGoal`
- `ChatSession` — conversation with `[Message]`, `extractedTopics`, `relatedGoalIDs`
- `Message` — `content`, `role` (user/assistant/system), `tokenCount`
- `LearningGoal` — `progress` (0–1), `prerequisiteIDs`, `relatedChatIDs`

---

## Testing

### Tauri Frontend
- `vitest` — unit and component tests in `tauri/src/tests/`
- Run: `npx vitest run`

### Tauri Backend
- `cargo check` and `cargo clippy -- -D warnings` — must pass before committing
- Run: `cargo check --manifest-path tauri/src-tauri/Cargo.toml`

### TypeScript
- Strict mode: `npx tsc --noEmit` must exit 0

### Swift
- XCTest in `Tests/AetheriumTests/`
- Run: `swift test`

---

## Build Commands

```bash
# TypeScript type-check
cd tauri && npx tsc --noEmit

# Frontend tests
cd tauri && npx vitest run

# Rust check
cargo check --manifest-path tauri/src-tauri/Cargo.toml

# Rust lint
cargo clippy --manifest-path tauri/src-tauri/Cargo.toml -- -D warnings

# Dev server (requires Ollama on :11434)
cd tauri && npm run tauri dev

# Swift build
swift build && swift test
```
