# Aetherium — Tauri Desktop Port

A cross-platform desktop rewrite of the Aetherium macOS app using **Tauri 2**, **React 18**, and **Rust**. The backend persistence layer uses SQLite (via `rusqlite`) instead of SwiftData. AI inference supports **Ollama**, **llama.cpp** (direct), **MLX** (Apple Silicon), and remote providers via the web AI bridge.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Shell | Tauri 2 |
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS + `@tailwindcss/typography` |
| Editor | CodeMirror 6 (Markdown) |
| State | Zustand stores + TanStack Query |
| Backend | Rust (Tokio async runtime) |
| Database | SQLite via `rusqlite` (bundled, r2d2 pool) |
| AI | Ollama, llama.cpp, MLX, Web AI providers (`reqwest`) |
| Embeddings | In-process vector index (`ndarray` / `rayon`) |
| MCP | Built-in MCP server + client |
| Graph | D3 v7 |
| Testing | Vitest + React Testing Library (frontend), Rust unit tests (backend) |

## Project Structure

```
tauri/
├── src/                          # React frontend
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/
│   │   ├── AppHeaderMenu.tsx
│   │   ├── ArtifactPanel.tsx       # Code artifact viewer
│   │   ├── ChatMessageBubble.tsx
│   │   ├── ChatMinimap.tsx
│   │   ├── CommandPalette.tsx      # ⌘K palette
│   │   ├── ContextIndicator.tsx
│   │   ├── ConvertChatModal.tsx
│   │   ├── Layout.tsx
│   │   ├── RelatedChatPills.tsx
│   │   ├── RoadmapGraph.tsx
│   │   ├── SelectionToolbar.tsx
│   │   ├── Sidebar.tsx
│   │   ├── SmartTextEditor.tsx     # CodeMirror 6 editor
│   │   ├── SplitPaneLayout.tsx
│   │   ├── StatusBar.tsx
│   │   ├── TopicChips.tsx
│   │   ├── WindowControls.tsx
│   │   ├── WordDefinitionTooltip.tsx
│   │   ├── WorkspaceMigrationBanner.tsx
│   │   ├── WorkspaceSurveyModal.tsx
│   │   └── ZoomIndicator.tsx
│   ├── hooks/                    # Custom React hooks
│   │   ├── useAiModelSync.ts
│   │   ├── useHotkeys.ts
│   │   ├── useNavigationHistory.ts
│   │   ├── useNavigationHotkeys.ts
│   │   ├── useSystemSpecs.ts
│   │   ├── useTextSelectionToolbar.ts
│   │   └── useWordHover.ts
│   ├── lib/
│   │   ├── api.ts                # Typed invoke() wrappers for all Tauri commands
│   │   ├── artifactDetection.ts
│   │   ├── composerSuggestions.ts
│   │   ├── modelDisplayName.ts
│   │   ├── modelFamilyGrouping.ts
│   │   ├── modelGroups.ts
│   │   ├── modelRoles.ts
│   │   ├── modelSizing.ts
│   │   ├── platform.ts
│   │   ├── theme.ts
│   │   └── treeLayout.ts
│   ├── models/                   # TypeScript type definitions
│   │   ├── artifact.ts
│   │   └── summary.ts
│   ├── stores/                   # Zustand state stores
│   │   ├── artifactStore.ts
│   │   ├── chatStore.ts
│   │   ├── settingsStore.ts
│   │   ├── uiStore.ts
│   │   └── workspaceStore.ts
│   ├── views/
│   │   ├── AuthenticationView.tsx
│   │   ├── BackupSettingsSection.tsx
│   │   ├── ChatView.tsx             # Main AI chat interface (with RAG)
│   │   ├── DailyNotesView.tsx
│   │   ├── DocumentBrowserView.tsx
│   │   ├── FlashcardReviewView.tsx
│   │   ├── FolderDashboardView.tsx
│   │   ├── GlobalBackupSection.tsx
│   │   ├── GlobalMemoryView.tsx
│   │   ├── HistoryView.tsx
│   │   ├── ImportSettingsSection.tsx
│   │   ├── KnowledgeGraphView.tsx   # D3 force graph
│   │   ├── LearningPathView.tsx
│   │   ├── LogsView.tsx
│   │   ├── MemoryView.tsx
│   │   ├── NoteEditorView.tsx
│   │   ├── PluginManagerView.tsx
│   │   ├── PreferencesView.tsx
│   │   ├── RecycleBinView.tsx
│   │   ├── SourceBrowserView.tsx
│   │   ├── ThoughtQueueView.tsx
│   │   ├── WebCaptureView.tsx
│   │   ├── WorkspaceMemoryPanel.tsx
│   │   └── WorkspaceSettingsView.tsx
│   ├── preferences/              # Preferences window entry point
│   ├── quick-search/             # Quick search window (⌘⇧K)
│   ├── styles/
│   └── tests/                    # Vitest frontend tests
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── commands/             # Tauri #[tauri::command] handlers
│   │   │   ├── ai_knowledge.rs
│   │   │   ├── ai_model.rs
│   │   │   ├── alarm.rs
│   │   │   ├── artifact.rs
│   │   │   ├── backup.rs
│   │   │   ├── chat.rs
│   │   │   ├── chat_conversion.rs
│   │   │   ├── chat_file.rs      # Import from Claude, LM Studio, Gemini
│   │   │   ├── context.rs
│   │   │   ├── dashboard.rs
│   │   │   ├── demo.rs
│   │   │   ├── document.rs
│   │   │   ├── export.rs
│   │   │   ├── flashcard.rs
│   │   │   ├── folder.rs
│   │   │   ├── git_sync.rs
│   │   │   ├── graph.rs
│   │   │   ├── knowledge_graph.rs
│   │   │   ├── learning_goal.rs
│   │   │   ├── llamacpp.rs
│   │   │   ├── log.rs
│   │   │   ├── mcp.rs
│   │   │   ├── memory.rs
│   │   │   ├── mlx.rs
│   │   │   ├── note.rs           # create/update auto-index [[wiki-links]]
│   │   │   ├── ollama.rs
│   │   │   ├── quick_search.rs
│   │   │   ├── search.rs
│   │   │   ├── security.rs
│   │   │   ├── settings.rs
│   │   │   ├── source.rs
│   │   │   ├── summary.rs
│   │   │   ├── system.rs
│   │   │   ├── thought_queue.rs
│   │   │   ├── topic_signature.rs
│   │   │   ├── web_ai.rs
│   │   │   ├── web_capture.rs
│   │   │   └── workspace.rs
│   │   ├── services/             # Business logic
│   │   │   ├── ai_content_generator.rs
│   │   │   ├── artifact_service.rs
│   │   │   ├── background_scheduler.rs
│   │   │   ├── backup_service.rs
│   │   │   ├── chat_conversion.rs
│   │   │   ├── chat_file_store/  # Multi-format chat import (Claude, LM Studio, Gemini)
│   │   │   ├── chat_service.rs
│   │   │   ├── concept_extractor.rs
│   │   │   ├── context_assembler.rs
│   │   │   ├── document_processor.rs
│   │   │   ├── export_engine.rs
│   │   │   ├── folder_service.rs
│   │   │   ├── git_sync.rs
│   │   │   ├── graph_algorithms.rs
│   │   │   ├── link_parser.rs
│   │   │   ├── linking_engine.rs   # [[wiki-link]] indexer
│   │   │   ├── memory_pipeline.rs
│   │   │   ├── model_settings.rs
│   │   │   ├── note_template_engine.rs
│   │   │   ├── quick_search_index.rs
│   │   │   ├── quick_search_service.rs
│   │   │   ├── retrieval_engine.rs
│   │   │   ├── semantic_search.rs
│   │   │   ├── settings.rs
│   │   │   ├── spaced_repetition.rs
│   │   │   ├── summarization_service.rs
│   │   │   ├── topic_signature.rs
│   │   │   ├── vector_index.rs
│   │   │   ├── workspace_hierarchy.rs
│   │   │   └── workspace_service.rs
│   │   ├── db/                   # Database connection pool + migrations
│   │   ├── models/               # Rust structs mirroring SQL schema
│   │   ├── ollama/               # Streaming Ollama client
│   │   ├── llamacpp/             # llama.cpp worker (optional, macOS Metal)
│   │   ├── mlx/                  # MLX inference client (Apple Silicon)
│   │   ├── mcp_client/           # Model Context Protocol client
│   │   ├── mcp_server/           # Built-in MCP server (resources, tools)
│   │   ├── bin/
│   │   │   └── aetherium-mcp-server.rs  # Standalone MCP server binary
│   │   ├── app_menu.rs
│   │   ├── logging.rs
│   │   ├── lib.rs
│   │   ├── main.rs
│   │   └── schema.sql            # SQLite schema (35 tables)
│   ├── capabilities/
│   ├── resources/
│   ├── icons/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── tauri.linux.conf.json
│   ├── tauri.macos.conf.json
│   └── tauri.windows.conf.json
├── scripts/
│   └── ensure-ollama.mjs        # Auto-start Ollama before dev
├── package.json
├── vite.config.ts
├── vitest.config.ts
├── eslint.config.js
├── tailwind.config.js
├── postcss.config.js
└── tsconfig.json
```

## Prerequisites

| Dependency | Minimum version | Notes |
|-----------|----------------|-------|
| Node.js | 18 | Tested with v20 via nvm |
| npm | 9 | |
| Rust | 1.77 | `rustup` recommended |
| Xcode CLT (macOS) | — | `xcode-select --install` |
| Ollama | latest | `brew install ollama` or `pacman -S ollama` |

## Getting Started

```bash
# 1. Install frontend dependencies
cd tauri
npm install

# 2. Pull a model (e.g. qwen2.5 or llama3)
ollama pull qwen2.5

# 3. Run in development mode (best-effort Ollama startup + Tauri watcher)
npm run dev:app

# Or manage Ollama yourself and run Tauri directly
npm run tauri dev

# Or build backend only (without UI focus-stealing)
npm run dev:backend
```

> **Tip:** In the app, enable **Preferences → AI → Auto-start local Ollama** if you want Aetherium to try launching `ollama serve` automatically on startup.

> **nvm users:** If `npm` is not on your `PATH`, prefix commands with the absolute path:
> ```bash
> ~/.nvm/versions/node/v20.19.5/bin/npm run tauri dev
> ```

### Platform-specific builds

```bash
npm run build:mac      # .app + .dmg
npm run build:linux    # .appimage + .deb + .rpm
npm run build:windows  # .msi + .nsis
```

The output is written to `src-tauri/target/release/bundle/`.

## Database

The app stores all data in a single SQLite file at the platform default app-data directory:

| Platform | Path |
|---------|------|
| macOS | `~/Library/Application Support/com.aetherium.app/aetherium.db` |
| Linux | `~/.local/share/com.aetherium.app/aetherium.db` |
| Windows | `%APPDATA%\com.aetherium.app\aetherium.db` |

The schema is defined in [src-tauri/src/schema.sql](src-tauri/src/schema.sql) and applied automatically on first launch. Tables include: `workspaces`, `folders`, `chat_sessions`, `messages`, `citations`, `learning_goals`, `learning_cards`, `learning_paths`, `path_milestones`, `concept_nodes`, `concept_links`, `concept_mentions`, `graph_statistics`, `note_templates`, `daily_notes`, `project_notes`, `uploaded_documents`, `document_chunks`, `web_captures`, `sources`, `source_chunks`, `audio_transcriptions`, `calendar_alarms`, `thought_queue`, `memories`, `memory_summaries`, `ai_models`, `settings`, `conversation_summaries`, `artifacts`, `artifact_embeddings`, `memory_embeddings`, `context_snapshots`, `quick_search_documents`, `app_logs`.

## Key Features

- **Notes** with full `[[wiki-link]]` backlink indexing (auto-updated on save)
- **Chat** — streaming AI chat sessions with RAG context assembly and conversation summaries
- **Multiple AI backends** — Ollama, llama.cpp (Metal), MLX (Apple Silicon), and remote web providers
- **AI Model management** — per-model role assignment, sizing, and family grouping
- **Artifacts** — automatic code/content extraction from chat responses with embedding search
- **Memory** — workspace-scoped and global memory pipelines with vector embeddings
- **MCP** — built-in Model Context Protocol server and client for tool/resource integration
- **Knowledge Graph** — interactive D3 force-directed concept graph with statistics
- **Flashcards** — spaced repetition (SM-2 algorithm) with learning cards
- **Learning Paths** — milestone-based progress tracking with prerequisite chains
- **Source Browser** — import, chunk, and search documents and web captures
- **Thought Queue** — capture quick ideas for later triage
- **Quick Search** — dedicated search window with indexed documents
- **Daily Notes** — date-stamped notes with templates
- **Folders** — workspace sub-organization with custom instructions and colors
- **Chat Import** — import conversations from Claude, LM Studio, and Google Gemini (via Takeout)
- **Git Sync** — version-controlled workspace sync
- **Backups** — incremental snapshot system with global and per-workspace restore
- **Recycle Bin** — soft-delete recovery
- **Topic Signatures** — automatic topic extraction and workspace fingerprinting
- **Command Palette** — `⌘K` quick-access to all actions
- **Preferences** — dedicated preferences window with import/export settings, plugin manager, and customizable theme/appearance
- **Security** — keyring-backed encryption, biometric authentication (macOS Touch ID)
- **Logging** — structured app logs viewable in-app

## Relationship to the Swift App

This Tauri port is a functional equivalent of the SwiftUI app in `swift/Sources/Aetherium/`. The data model was ported from SwiftData `@Model` classes to an equivalent SQLite schema. The two apps share no runtime code but maintain feature parity.

## Development Notes

- All Tauri IPC calls are typed in [`src/lib/api.ts`](src/lib/api.ts) — add new commands there first.
- The Rust service layer (`src-tauri/src/services/`) contains business logic that commands delegate to; keep commands thin.
- Platform-specific Tauri config overrides live in `tauri.linux.conf.json`, `tauri.macos.conf.json`, and `tauri.windows.conf.json`.
- The window starts maximized at 1400×900 with a 1024×700 minimum (set in `tauri.conf.json`).
- CSP is currently `null` (development convenience) — tighten before shipping.
- Lint with `npm run lint`, type-check with `npm run typecheck`, test with `npm test`.
- Pre-commit hooks via Husky + lint-staged enforce ESLint on staged `.ts`/`.tsx` files.
