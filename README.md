# Aetherium

> **Local-first AI learning companion**

Aetherium combines conversational AI, source-grounded research, bidirectional knowledge graphs, and flexible organization—all powered by local Ollama models. Your data remains on your machine.

![Swift](https://img.shields.io/badge/Swift-5.9-orange.svg)
![SwiftUI](https://img.shields.io/badge/SwiftUI-macOS%2014+-blue.svg)
![Rust](https://img.shields.io/badge/Rust-Tauri%20v2-orange.svg)
![React](https://img.shields.io/badge/React-TypeScript-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## Two Implementations

| | Swift / macOS (On hold) | Tauri (active) |
|---|---|---|
| **Language** | Swift 5.9 + SwiftUI + SwiftData | Rust (Tauri v2) + React + TypeScript |
| **Platform** | macOS 14+ only | macOS, Windows, Linux |
| **Storage** | SwiftData (Core Data) | SQLite via `rusqlite` |
| **Entry point** | `swift/Sources/Aetherium/` | `tauri/` |
| **Backends** | Ollama | Ollama, MLX, Llama.cpp |
| **Status** | Feature-complete (on hold) | **Active production target** |

The Tauri port is the primary development target and receives all new features.

## Roadmap

`docs/todo.md` tracks the Tauri app roadmap only. It should not be read as the status board for the Swift/macOS implementation.

## Features

### AI Chat with Source Grounding
- Converse with local Ollama, **MLX**, and **Llama.cpp** models
- **Source-grounded responses** with automatic citations (RAG)
- **Artifacts**: Side-by-side rendering of generated code, diagrams, and markdown documents
- **LaTeX Math Rendering**: Inline and block math equations rendered via KaTeX
- **Dual-model comparison**: Benchmark different models against the same prompt
- **Multi-pane Workspaces**: Split-view support for working on different chats or documents side-by-side
- **Sub-workspace support**: Hierarchical workspace nesting with right-click context menus and scoped AI containment
- **Folder-based chat organization**: Group chat sessions into folders within a workspace
- **Unread indicators**: Visual badges on chat sessions with messages received since last visit
- **Contextual Navigation**: Link related conversations via "Related Chat Excerpts" that automatically surface past knowledge
- **Workspace Domain Context**: Active workspace topics automatically injected as system context on each send
- **Model Context Protocol (MCP)**: Dynamic tool and resource integration for AI models via external servers
- **AI Models Registry**: Manage local models and web providers (ChatGPT, Claude, DeepSeek, Gemini); set a per-model context-window override (`num_ctx`) directly in Preferences
- **Oversized-model guardrail**: Pre-send dialog warns when a model's estimated VRAM/RAM footprint exceeds available memory, with a per-model "don't ask again" option
- **Model unloading**: Manually free VRAM/RAM by unloading idle Ollama models; automatic unload on stream error or abort
- **Chat-to-Note / Chat-to-Document conversion**: One-click export of a session to a summarized note or document, with LLM-based concept extraction that auto-populates the knowledge graph
- Chat session history with rename / soft-delete; Recycle Bin for restoration
- **History view**: Dedicated browser for all past sessions, grouped by date with instant search
- **Dashboard search**: Quick search input on the dashboard with instant new-chat redirect
- **Thought Queue**: Background AI processing for scheduled or deferred tasks
- **Generation metrics**: Detailed inference logs and performance stats per message
- **Status Bar Telemetry**: Real-time monitoring of background job states and active AI streams
- **Tray icon streaming indicator**: System tray icon animates to signal an active AI generation

### Intelligent Memory
- **Fact Extraction**: Automatically identifies and saves user facts and preferences from conversations
- **Context Persistence**: Durable memory that can be pinned or scoped to specific workspaces
- **Embedding-based Retrieval**: Fast semantic lookup of relevant memories during chat

### Knowledge Graph
- **Bidirectional linking**: Obsidian-style `[[concept]]` syntax across all notes and chats
- Interactive graph visualization with force-directed layout
- **Textbook hierarchy**: Graduated taxonomy (Part → Chapter → Section → Concept) for structured knowledge organization
- Multiple concept and link types (Topic, Person, Technology, Related, Prerequisite, etc.)
- Backlinks panel showing where concepts are referenced
- Concepts auto-populated from chat-to-note and document upload conversions
- **Workspace Glossary**: Auto-extracted domain terms with inline hover definitions surfaced across notes and chat

### Data Synchronization & Resilience
- **Git-based Sync**: Automatic background synchronization to private Git repositories via SSH
- **Automated Backups**: Configurable local database backups with version history
- **Data Portability**: Import from LM Studio and Google Gemini; export to Markdown or Obsidian
- **Topic-based Routing**: Automatic workspace selection based on message content via Topic Signatures

### Full-Text & Semantic Search
- **Command Palette (Cmd+K)**: Instant global search across all content
- **FTS5 Optimized Retrieval**: High-performance keyword search with SQL-native Full-Text Search triggers
- Semantic search using local Ollama embeddings
- Hybrid matching combining vector similarity with keyword search

### Smart Editor & Daily Notes
- **Live Markdown**: Real-time rendering with syntax highlighting
- **Daily Notes**: Performance-optimized calendar view with mood and productivity tracking
- **Templates**: Variable substitution (`{{date}}`, `{{project}}`) for meeting notes, study sessions, etc.

### Spaced Repetition (Flashcards)
- **SM-2 Algorithm**: Optimized review scheduling for long-term retention
- Card generation from documents or concept nodes
- Full keyboard-driven review interface

### Learning Paths
- Structured learning journeys with milestones linked to chat sessions and documents
- Progress tracking per milestone; paths scoped to a workspace

### Plugin Manager
- In-app manager for enabling, disabling, and configuring extensible plugins

### Privacy & Security
- **Local-first**: All data, embeddings, and inference remain on your machine
- **Real-time System Observability**: Live status bar monitoring CPU, RAM, and GPU/VRAM telemetry
- **Diagnostics & Logs**: Integrated logging and diagnostic hub for troubleshooting local AI performance
- **PIN Protection**: Optional application lock with PIN
- **Biometric Security**: macOS Touch ID support (Tauri/Swift)
- **Encryption**: Optional database encryption for sensitive chat history

## Getting Started

### Prerequisites

- **Ollama** installed ([ollama.ai](https://ollama.ai))

```bash
# Pull required models
ollama pull qwen2.5
ollama pull nomic-embed-text
```

> **Note:** The Tauri app can auto-start Ollama if the binary is in your path.

---

### Tauri App (Cross-platform — Recommended)

**Additional prerequisites:**
- [Rust](https://rustup.rs) toolchain (`cargo`)
- Node.js 20+
- macOS: Xcode command-line tools

```bash
cd tauri
npm install
npm run tauri dev
```

---

### Swift App (macOS only)

**Additional prerequisites:**
- macOS 14.0+
- Xcode 15.0+

```bash
# From repo root
open Package.swift   # opens in Xcode
```

## Keyboard Shortcuts

### Global
- `Cmd+K` - Command palette
- `Cmd+Shift+K` - Quick Search
- `Cmd+N` - New chat
- `Cmd+Shift+N` - New note
- `Cmd+S` - Save
- `Cmd+Q` - Quit

### Navigation
- `Cmd+1` - Dashboard
- `Cmd+2` - Chat
- `Cmd+3` - Notes
- `Cmd+4` - Documents
- `Cmd+5` - Intelligent Memory
- `Cmd+6` - Web Captures
- `Cmd+7` - Knowledge Graph
- `Cmd+8` - History
- `Cmd+9` - Preferences
- `Cmd+Shift+,` - Open Preferences in new window
- `F12` - Toggle Developer Tools

## Architecture (Tauri Target)

```
tauri/
├── src/                    # Frontend
│   ├── views/              # Page components (Dashboard, Chat, Memory, Graph…)
│   ├── components/         # Shared UI (Layout, Sidebar, CommandPalette…)
│   ├── lib/api.ts          # Type-safe IPC bridge
│   └── stores/             # Zustand state management
└── src-tauri/              # Backend
    ├── src/commands/       # Tauri command handlers
    ├── src/services/       # Business logic (Sync, RAG, Memory, Search…)
    ├── src/models/         # Database and wire models
    └── schema.sql          # SQLite source of truth
```

**Frontend:** React 18, TypeScript, Tailwind CSS, Zustand, Vite  
**Backend:** Rust, Tauri v2, rusqlite, serde, reqwest

### SQLite Schema Overview

| Table | Purpose |
|---|---|
| `workspaces` | Top-level workspace isolation |
| `folders` | Hierarchical chat organization within workspaces |
| `chat_sessions` | Conversational threads with RAG support |
| `messages` | Individual chat messages (role: user / assistant) |
| `sources` | Unified storage for Documents and Web Captures |
| `source_chunks` | Chunked source content for semantic retrieval |
| `artifacts` | Renderable documents and code generated in chat |
| `memories` | Long-term facts and preferences with embeddings |
| `concept_nodes` | Nodes in the bidirectional knowledge graph |
| `concept_links` | Directed edges between concept nodes |
| `daily_notes` | Chronological learning logs |
| `note_templates` | Markdown note templates with variable substitution |
| `learning_cards` | Spaced-repetition items (SM-2) |
| `learning_paths` | Structured learning journeys with milestones |
| `learning_goals` | Milestone targets within a learning path |
| `workspace_glossary_terms` | Auto-extracted domain terms and hover definitions |
| `thought_queue` | Background task orchestration |
| `calendar_alarms` | Scheduled AI-triggered reminders |
| `ai_models` | Local and Web AI provider registry with per-model context-size overrides |
| `settings` | Global application preferences |
| `app_logs` | Application diagnostics and inference logs |

## Contributing

Contributions are welcome. Please refer to [AGENTS.md](AGENTS.md) for development conventions.

## License

This project is licensed under the MIT License.

## Acknowledgments

- **Ollama**: Local AI infrastructure
- **Obsidian**: Knowledge organization inspiration
- **NotebookLM**: Focused research patterns
- **SuperMemo**: Spaced-repetition concepts
