# Aetherium

> **Local-first AI learning companion**

Aetherium combines conversational AI, source-grounded research, bidirectional knowledge graphs, and flexible organization—powered by local models (Ollama, MLX, Llama.cpp) and external AI providers. Your data remains on your machine.

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
- **Personalization Profile ("About You")**: Configure a custom learner profile (display name, profession, education level, preferred language, default learning approach, and interests) to be prepended to the chat system prompt, adapting the AI's responses to your background.
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
- **Bidirectional linking**: Obsidian-style `[[topic]]` syntax across all notes and chats
- Interactive graph visualization with force-directed layout
- **Textbook hierarchy**: Graduated taxonomy (Part → Chapter → Section → Concept) for structured knowledge organization
- Multiple topic and link types (Topic, Person, Technology, Related, Prerequisite, etc.)
- Backlinks panel showing where topics are referenced
- Topics auto-populated from chat-to-note and document upload conversions
- **Workspace Glossary**: Auto-extracted domain terms with inline hover definitions surfaced across notes and chat
- **Roadmap Export**: Export knowledge roadmaps in multiple formats (Markdown, JSON, Mermaid diagram code, CSV, PNG image, and PDF document).

### Data Synchronization & Resilience
- **Git-based Sync**: Automatic background synchronization to private Git repositories via SSH
- **Automated Backups**: Configurable local database backups with version history
- **Data Portability**: Comprehensive imports from **Anthropic Claude** (Legacy, v2, and v3 split-archives with project routing, clustering, and memory extraction), **ChatGPT**, **LM Studio** (single and batch multi-folder), and **Google Gemini (Takeout)**; export chats to JSON, notes and sessions to Markdown or Obsidian-compatible vaults, and full database backups (`.aebak`)
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

## Importing Claude Data Exports

Aetherium provides a dedicated, resilient pipeline for importing data exports from [Claude](https://claude.ai) and the Claude Desktop app into local workspaces, preserving conversation threads, project system instructions, reference files, and account-level memories.

### The Challenge: Fast-Evolving Export Formats

Anthropic has iteratively redesigned its data export packaging across multiple generations:
- **Legacy Format (v1)**: A single monolithic `.zip` archive containing `conversations.json`, `projects.json`, `memories.json`, and `users.json`.
- **v2 Format (May 2026)**: Shifted to a structured directory hierarchy: individual project definitions in `projects/<project-uuid>.json` (containing custom instructions and reference `docs`), project-associated chats in `design_chats/<uuid>.json`, and scoped project memories in `memories.json`. Crucially, Anthropic stripped project identifiers from `conversations.json`, leaving unlinked chats as unassigned "orphans".
- **v3 Format (August 30, 2026+ Split Delivery)**: Anthropic replaced single-archive downloads with a manifest-driven multi-part delivery: an `export-<date>.json` manifest containing single-use, time-limited download URLs pointing to multiple separate zip files (`conversations-000.zip`, `conversations-001.zip`, `projects.zip`, `memories.zip`, etc.). In addition, memories transitioned from a single JSON array into a `memories/` directory containing per-account records (`memories/<account-uuid>.json`) alongside markdown memory files (`/profile.md`, `/topics/*.md`).

#### Common Export Pitfalls & Data Loss
1. **Split-Part Overwrites**: Multi-part exports (e.g., `conversations-000.zip` and `conversations-001.zip`) both contain an internal file named `conversations.json`. Unpacking or merging them with standard file managers (such as macOS Finder or Archive Utility) causes the second part to overwrite the first, silently discarding half your conversation history.
2. **Scattered Folders**: Extracting multiple `.zip` archives by hand often creates isolated subdirectories, preventing the importer from finding correlated projects and conversations.
3. **Single-Use Download Links**: Download URLs listed in Claude manifest files expire quickly or fail after the first fetch.

---

### Preparing Claude Exports (`scripts/prepare_claude_export.py`)

To ensure clean, complete ingestion without data loss, Aetherium includes a standalone helper script (`scripts/prepare_claude_export.py`) using only the Python standard library (no `pip install` required; works on macOS, Linux, and Windows):

```bash
# Option A: Download archives only (without unpacking)
python3 scripts/download_claude_export.py ~/Downloads/manifest.json -d ~/Downloads/claude-zips

# Option B: Download and unpack/prepare in one step
python3 scripts/prepare_claude_export.py ~/Downloads/manifest.json -o ~/claude-export

# Option C: Unpack already downloaded .zip files
python3 scripts/prepare_claude_export.py ~/Downloads/claude-zips -o ~/claude-export
```

**What the scripts do:**
- **Automated Retrieval**: Downloads all `.zip` parts using browser headers (`User-Agent`) to prevent 403 blocks from Cloudflare/Claude.ai, with live transfer progress indicators.
- **Link & Manifest Parsing**: Supports official Anthropic manifest JSON files as well as plain `.txt` files containing export links.
- **Array Concatenation**: Safely merges multi-part JSON arrays (e.g. `conversations.json`) across split archives instead of overwriting them.
- **Archive Safety**: Enforces zip integrity validation and zip-slip path prevention.
- **Completeness Verification**: Validates the output directory structure (`conversations.json`, `projects/`, `memories/`, `design_chats/`) and outputs a verified folder ready for Aetherium.

---

### In-App Import Engine & Architecture

Once the export folder is prepared, point Aetherium's importer at it via **Preferences → Import → Claude**. The import engine executes the following pipeline:

#### 1. Automatic Format Detection
The engine inspects the folder structure and memory layout:
- Distinguishes automatically between **Legacy**, **v2**, and **v3** layouts.
- Identifies memory locations (per-account `memories/` directory vs. legacy `memories.json`).
- Flags unmerged split-part leftovers (e.g., `*-001.json`) to warn you before any import proceeds.

#### 2. Project & Workspace Mapping
- **Hierarchy Placement**: Map any Claude project to a new top-level Workspace, a Sub-Workspace, or a Folder within an existing workspace.
- **Asset Preservation**: Automatically imports project custom system instructions (`prompt_template`) and attached knowledge files (`docs`) into the target workspace.
- **Remembered Destinations**: Remembers your preferred folder mappings across repeated imports.

#### 3. Multi-Tiered Orphan Chat Matching
Because Claude's export strips project identifiers from `conversations.json`, Aetherium uses a layered matching engine to accurately suggest which project each orphan conversation belongs to:
1. **Title Matching**: Exact and substring matching against project names.
2. **Topical Keyword Coverage (IDF Scoring)**: Computes inverse document frequency (IDF) mass over discriminative terms across project descriptions, docs, prompts, and titles. Conversational filler words are suppressed, and user-configurable strictness margins (**Strict**, **Balanced**, **Loose**) control the required confidence gap over runner-up projects.
3. **Semantic Embedding Similarity**: When local Ollama embedding models (e.g., `nomic-embed-text`) are configured, computes cosine similarity between project source text and chat excerpts, rescuing relevant chats that share conceptual meaning without exact keyword overlap.
4. **LLM Classification**: Optional batched local LLM pass for zero-shot categorization.
5. **Interactive Review**: The UI surfaces match reasons (`title`, `keywords`, `topics`, `semantic`, `llm`), confidence scores, and runner-up candidates for confirmation before committing.

#### 4. Unmatched Conversation Clustering
Orphan chats that belong to no existing Claude project are not left as an undifferentiated list. Aetherium runs an unsupervised clustering pass:
- Groups leftover chats by embedding similarity (cosine similarity against cluster centroid and seed to avoid drift) or lexical title overlap.
- Uses a local LLM to synthesize descriptive folder names (e.g. `Suggested: Docker & DevOps`).

#### 5. Account-Level & Project-Level Memory Ingestion
- Scopes project-specific memories into their corresponding workspace context.
- Parses account-level user profile and topic files from Claude v3 markdown memory directories (`/profile.md`, `/topics/*.md`):
  - Strips YAML frontmatter.
  - Cleans provenance tags (e.g., `[stated]`, `[implied]`).
  - Splits bullet points into discrete `fact` and `preference` records stored in Aetherium's Intelligent Memory table (`memories`).

#### 6. Idempotent Re-Import & Link Tracking
- Maintains persistent mappings in `import_source_links`, `import_destinations`, and `import_memory_links`.
- Re-importing newer exports recognizes previously imported sessions and memories by their source UUIDs, preventing duplicate chats and allowing selective in-place updates or destination restorations.

#### 7. Direct Backup Conversion
- In addition to interactive UI import, Aetherium can transform a Claude export folder directly into a standard Aetherium `.aebak` JSON backup file, allowing entire archives to be imported or restored in one click.

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
- Node.js 22 (pinned via `.nvmrc`)
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

### Key Architecture Patterns & Optimizations
- **Single-Key Settings Updates (`updateOne`)**: Common interactive settings updates (e.g., preferred models, font size zoom, and theme settings) execute as direct single-key database writes. This bypasses the overhead of serializing/deserializing the complete 70+ field application settings structure across the Tauri IPC bridge.
- **Cross-Window Store Synchronization**: Application settings are managed reactively via a Zustand `settingsStore` that hydrates at startup and automatically synchronizes updates across all open windows in real-time.

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
| `import_source_links` | Provenance links mapping imported sessions (e.g. Claude UUIDs) to app sessions to prevent duplicates |
| `import_destinations` | Remembered target workspace and folder mappings for imported projects |
| `import_memory_links` | Provenance tracking for imported account and project-scoped memories |

## Contributing

Contributions are welcome. Please refer to [AGENTS.md](AGENTS.md) for development conventions.

## License

This project is licensed under the MIT License.

## Acknowledgments

- **Ollama**: Local AI infrastructure
- **Obsidian**: Knowledge organization inspiration
- **NotebookLM**: Focused research patterns
- **SuperMemo**: Spaced-repetition concepts
