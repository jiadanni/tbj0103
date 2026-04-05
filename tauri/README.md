# Aetherium — Tauri Desktop Port

A cross-platform desktop rewrite of the Aetherium macOS app using **Tauri 2**, **React 18**, and **Rust**. The backend persistence layer uses SQLite (via `rusqlite`) instead of SwiftData, and AI inference still talks to a local **Ollama** instance.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Shell | Tauri 2 |
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS + `@tailwindcss/typography` |
| Editor | CodeMirror 6 (Markdown) |
| State | Zustand stores + TanStack Query |
| Backend | Rust (Tokio async runtime) |
| Database | SQLite via `rusqlite` (bundled) |
| AI | Ollama HTTP API (`reqwest`) |
| Graph | D3 v7 |

## Project Structure

```
tauri/
├── src/                        # React frontend
│   ├── App.tsx
│   ├── components/
│   │   ├── CommandPalette.tsx   # ⌘K palette
│   │   ├── Layout.tsx
│   │   ├── Sidebar.tsx
│   │   └── SmartTextEditor.tsx  # CodeMirror 6 editor
│   ├── lib/
│   │   └── api.ts              # Typed invoke() wrappers for all Tauri commands
│   ├── stores/                 # Zustand state stores
│   ├── views/
│   │   ├── AuthenticationView.tsx
│   │   ├── BacklinksView.tsx        # Wiki-link backlink graph
│   │   ├── BackupSettingsSection.tsx
│   │   ├── ChatView.tsx            # Main AI chat interface (with RAG support)
│   │   ├── DailyNotesView.tsx
│   │   ├── DocumentBrowserView.tsx
│   │   ├── FlashcardReviewView.tsx
│   │   ├── KnowledgeGraphView.tsx  # D3 force graph
│   │   ├── LearningPathView.tsx
│   │   ├── ProjectDashboardView.tsx
│   │   └── SettingsView.tsx
│   └── styles/
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── commands/           # Tauri #[tauri::command] handlers
│   │   │   ├── alarm.rs
│   │   │   ├── backup.rs
│   │   │   ├── chat.rs
│   │   │   ├── demo.rs
│   │   │   ├── document.rs
│   │   │   ├── export.rs
│   │   │   ├── flashcard.rs
│   │   │   ├── graph.rs
│   │   │   ├── knowledge_graph.rs
│   │   │   ├── learning_goal.rs
│   │   │   ├── note.rs         # create/update auto-index [[wiki-links]]
│   │   │   ├── ollama.rs
│   │   │   ├── project.rs
│   │   │   ├── search.rs
│   │   │   ├── settings.rs
│   │   │   └── workspace.rs
│   │   ├── services/           # Business logic
│   │   │   ├── ai_content_generator.rs
│   │   │   ├── backup_service.rs
│   │   │   ├── concept_extractor.rs
│   │   │   ├── document_processor.rs
│   │   │   ├── export_engine.rs
│   │   │   ├── graph_algorithms.rs
│   │   │   ├── link_parser.rs
│   │   │   ├── linking_engine.rs  # [[wiki-link]] indexer
│   │   │   ├── note_template_engine.rs
│   │   │   ├── retrieval_engine.rs
│   │   │   ├── semantic_search.rs
│   │   │   ├── settings.rs
│   │   │   └── spaced_repetition.rs
│   │   ├── db/                 # Database connection + migrations
│   │   ├── models/             # Rust structs mirroring SQL schema
│   │   ├── ollama/             # Streaming Ollama client
│   │   ├── lib.rs
│   │   ├── main.rs
│   │   └── schema.sql          # SQLite schema (ported from SwiftData models)
│   ├── capabilities/
│   ├── icons/
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── tsconfig.json
```

## Prerequisites

| Dependency | Minimum version | Notes |
|-----------|----------------|-------|
| Node.js | 18 | Tested with v20 via nvm |
| npm | 9 | |
| Rust | 1.77 | `rustup` recommended |
| Xcode CLT (macOS) | — | `xcode-select --install` |
| Ollama | latest | `brew install ollama` |

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

## Build for Production

```bash
npm run tauri build
```

The signed `.app` (macOS), `.deb` / `.rpm` (Linux), or `.msi` / `.exe` (Windows) will be written to `src-tauri/target/release/bundle/`.

## Database

The app stores all data in a single SQLite file at the platform default app-data directory:

| Platform | Path |
|---------|------|
| macOS | `~/Library/Application Support/com.aetherium.app/aetherium.db` |
| Linux | `~/.local/share/com.aetherium.app/aetherium.db` |
| Windows | `%APPDATA%\com.aetherium.app\aetherium.db` |

The schema is defined in [src-tauri/src/schema.sql](src-tauri/src/schema.sql) and applied automatically on first launch. Tables include: `workspaces`, `projects`, `chat_sessions`, `messages`, `citations`, `learning_goals`, `concept_nodes`, `concept_links`, `notes`, `note_links`, `flashcards`, `alarms`, `backups`.

## Key Features

- **Notes** with full `[[wiki-link]]` backlink indexing (auto-updated on save)
- **Chat** — streaming Ollama chat sessions (with RAG support)
- **Knowledge Graph** — interactive D3 force-directed concept graph
- **Flashcards** — spaced repetition (SM-2 algorithm)
- **Learning Goals** — progress tracking with prerequisite chains
- **Document Browser** — import and process PDFs
- **Daily Notes** — date-stamped notes with templates
- **Backups** — incremental snapshot system with timeline restore
- **Command Palette** — `⌘K` quick-access to all actions
- **Settings** — start at login, open in background (no focus-stealing), customizable theme/appearance

## Relationship to the Swift App

This Tauri port is a functional equivalent of the SwiftUI app in `Sources/Aetherium/`. The data model was ported from SwiftData `@Model` classes to an equivalent SQLite schema. The two apps share no runtime code but maintain feature parity.

## Development Notes

- All Tauri IPC calls are typed in [`src/lib/api.ts`](src/lib/api.ts) — add new commands there first.
- The Rust service layer (`src-tauri/src/services/`) contains business logic that commands delegate to; keep commands thin.
- The window size starts at 1400×900 with a 1024×700 minimum (set in `tauri.conf.json`).
- CSP is currently `null` (development convenience) — tighten before shipping.
