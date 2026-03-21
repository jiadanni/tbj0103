# Aetherium

> **Your local-first AI learning companion**

Aetherium combines ChatGPT-style conversations, NotebookLM's source grounding, Obsidian's knowledge graphs, and Notion's organisation—all powered by local Ollama AI models for complete privacy. No data leaves your machine.

![Swift](https://img.shields.io/badge/Swift-5.9-orange.svg)
![SwiftUI](https://img.shields.io/badge/SwiftUI-macOS%2014+-blue.svg)
![Rust](https://img.shields.io/badge/Rust-Tauri%20v2-orange.svg)
![React](https://img.shields.io/badge/React-TypeScript-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## Two Implementations

| | Swift / macOS | Tauri (active) |
|---|---|---|
| **Language** | Swift 5.9 + SwiftUI + SwiftData | Rust (Tauri v2) + React + TypeScript |
| **Platform** | macOS 14+ only | macOS, Windows, Linux |
| **Storage** | SwiftData (Core Data) | SQLite via `rusqlite` |
| **Entry point** | `Sources/Aetherium/` | `tauri/` |
| **Status** | Feature-complete | **Active development target** |

The Tauri port is the primary development target and receives all new features.

## ✨ Features

### 🤖 AI Chat with Source Grounding
- Converse with local Ollama models (llama3, qwen2.5, etc.)
- **Source-grounded responses** with automatic citations (RAG)
- Upload documents (PDF, TXT, Markdown, HTML, RTF)
- Capture web pages; audio transcriptions via macOS Speech framework
- Chat session history with rename / delete
- Model comparison view to benchmark responses side-by-side
- AI-generated study guides and quizzes

### 🧠 Knowledge Graph
- **Obsidian-style bidirectional linking** with `[[concept]]` syntax
- Interactive graph visualization
- 8 concept types: Topic, Person, Technology, Definition, Question, Insight, Resource, Custom
- 6 link types: Related, PartOf, Prerequisite, Contradicts, Supports, Example
- Auto-detect concept mentions across all content
- Backlinks panel showing where concepts are referenced

### 🔍 Semantic Search
- **Cmd+K command palette** for instant search
- Semantic search using Ollama embeddings (nomic-embed-text)
- Search across documents, chats, concepts, and notes
- Cosine similarity matching with fallback to keyword search

### ✍️ Smart Editor
- **Live Obsidian-style linking** with auto-complete
- Three modes: Live, Preview, Split view
- Markdown rendering with syntax highlighting
- Auto-save with 2-second debounce
- Real-time `[[concept]]` detection
- Word count, character count, link statistics

### 📅 Daily Notes + Templates
- Interactive calendar with 7x7 grid navigation
- **6 built-in templates**:
  - Daily Note
  - Meeting Notes
  - Learning Session
  - Weekly Review
  - Project Planning
  - Quick Note
- Variable substitution: `{{date}}`, `{{project}}`, `{{username}}`, etc.
- Mood tracking (5 levels)
- Productivity scoring (1-10)
- Streak tracking

### 🎴 Flashcards + Spaced Repetition
- **SM-2 algorithm** for optimal review scheduling
- Card flipping animations with 3D rotation
- 4 quality ratings: Forgot, Hard, Good, Easy
- Session stats with accuracy tracking
- Keyboard shortcuts (Space to reveal, 0-5 for rating)
- Leitner System alternative

### 🛤️ Learning Paths
- Milestone tracking with progress visualization
- Target completion dates
- Concept linking to milestones
- Progress percentage calculation
- Completion celebrations

### 📊 Analytics Dashboard
- **Activity heatmap** (49-day grid)
- Concept growth charts
- Review accuracy charts
- Recent activity feed
- **AI-powered insights**:
  - Learning pace recommendations
  - Review accuracy feedback
  - Activity consistency tracking
  - Concept connection suggestions

### 🎤 Voice + Export
- **Real-time speech-to-text** using macOS Speech framework
- Audio file transcription
- **4 export formats**:
  - Markdown (single file)
  - Obsidian Vault (folder structure)
  - PDF (formatted)
  - JSON (data portability)

### 🧩 Plugin System
- **Extensible architecture** with 7 plugin types:
  - **Importers**: Bring data from external sources
  - **Exporters**: Export to custom formats
  - **AI Models**: Integrate custom AI models
  - **Visualizations**: Custom data visualizations
  - **Automations**: Triggered actions
  - **Note Types**: Custom note formats
  - **Integrations**: External service sync
- **5 built-in plugins**:
  - Markdown Exporter
  - Obsidian Vault Exporter
  - YouTube Transcript Importer
  - Anki Flashcard Exporter
  - Daily Summary Automation
- Plugin discovery and management UI
- Install custom plugins (.aetheriumplugin bundles)
- Permission system for plugin security

## 🚀 Getting Started

### Prerequisites (both apps)

- **Ollama** installed and running ([ollama.ai](https://ollama.ai))

```bash
# Install and start Ollama
brew install ollama
ollama serve

# Pull required models
ollama pull qwen2.5
ollama pull nomic-embed-text
```

---

### Tauri App (cross-platform — recommended)

**Additional prerequisites:**
- [Rust](https://rustup.rs) toolchain (`cargo`)
- Node.js 20+ (via [nvm](https://github.com/nvm-sh/nvm) or directly)
- On macOS: Xcode command-line tools

```bash
# Clone
git clone https://github.com/your-username/aetherium.git
cd aetherium/tauri

# Install JS dependencies
npm install

# Run in development mode
npm run tauri dev
```

> **Note:** If `node`/`npm` are not on `$PATH`, use absolute paths:
> ```bash
> PATH="$HOME/.cargo/bin:$HOME/.nvm/versions/node/v20.19.5/bin:$PATH" npm run tauri dev
> ```

---

### Swift App (macOS only)

**Additional prerequisites:**
- macOS 14.0+ (Sonoma or later)
- Xcode 15.0+

```bash
# From repo root
open Package.swift   # opens in Xcode
# or: swift run Aetherium
```

1. **Authenticate** with Touch ID / Face ID
2. **Create a workspace**, then a project
3. Start learning!

## 📖 Usage Guide

### Creating a Project

1. Press `Cmd+N` or click "Create New Project"
2. Enter a title and description
3. Set learning goals
4. Start adding sources and chatting!

### Adding Sources

Navigate to **Documents** (Cmd+4):
- **Import documents**: PDF, TXT, Markdown, HTML, RTF
- **Capture webpages**: Extract content from URLs
- **Create notes**: Write directly in Aetherium
- **Record audio**: Transcribe voice recordings

All sources are automatically processed and chunked for semantic search.

### Chatting with AI

Navigate to **Chat** (Cmd+2):
1. Create a new chat (Cmd+Shift+N)
2. Type your question
3. AI responds with **citations** from your sources
4. Click citations to see source context

### Building Knowledge

Navigate to **Knowledge Graph** (Cmd+5):
1. View your concept network
2. Create concepts manually or from documents
3. Link related concepts
4. Explore connections visually

### Taking Daily Notes

Navigate to **Daily Notes** (Cmd+3):
1. Select a date from the calendar
2. Choose a template or start blank
3. Use `[[concept]]` syntax to link ideas
4. Set mood and productivity for the day

### Creating Flashcards

Navigate to **Flashcards** (Cmd+6):
1. Create cards from concepts
2. Or auto-generate from documents
3. Review due cards
4. Rate your recall: Forgot, Hard, Good, Easy
5. Watch your retention improve!

### Tracking Progress

Navigate to **Dashboard** (Cmd+1):
- View activity heatmap
- Track concept growth
- Monitor review accuracy
- Get AI insights

### Managing Plugins

Navigate to **Plugins** (Cmd+8):
1. **View installed plugins** - See all active and loaded plugins
2. **Browse available plugins** - 5 built-in plugins ready to use
3. **Load/unload plugins** - Activate or deactivate plugins
4. **Install custom plugins** - Import .aetheriumplugin bundles
5. **Plugin permissions** - Review required permissions

**Built-in Plugins:**
- **Markdown Exporter** - Export entire project as Markdown
- **Obsidian Vault Exporter** - Create Obsidian-compatible vault
- **YouTube Importer** - Import video transcripts
- **Anki Exporter** - Export flashcards to Anki CSV format
- **Daily Summary** - Auto-generate daily summaries

## ⌨️ Keyboard Shortcuts

### Global
- `Cmd+K` - Command palette (semantic search)
- `Cmd+N` - New project
- `Cmd+Shift+N` - New chat
- `Cmd+S` - Save
- `Cmd+Q` - Quit

### Navigation
- `Cmd+1` - Dashboard
- `Cmd+2` - Chat
- `Cmd+3` - Daily Notes
- `Cmd+4` - Documents
- `Cmd+5` - Knowledge Graph
- `Cmd+6` - Flashcards
- `Cmd+7` - Learning Paths
- `Cmd+8` - Plugins

### Editor
- `[[` - Trigger concept autocomplete
- `Cmd+S` - Save note
- `Cmd+Enter` - Send message

### Flashcards
- `Space` - Reveal answer
- `0` - Forgot
- `3` - Hard
- `4` - Good
- `5` - Easy

## 🏗️ Architecture

### Tauri App (active target)

```
tauri/
├── src/                    # React + TypeScript frontend
│   ├── views/              # 20 page-level views
│   ├── components/         # Shared UI (Layout, Sidebar, CommandPalette…)
│   ├── lib/api.ts          # All Tauri invoke() wrappers (single source)
│   ├── stores/             # Zustand global state
│   └── styles/             # Tailwind CSS v3
└── src-tauri/              # Rust backend (Tauri v2)
    ├── src/commands/       # Thin Tauri command handlers
    ├── src/services/       # Business logic (linking, search, RAG…)
    ├── src/models/         # Rust structs (Serialize / Deserialize)
    ├── src/db/             # SQLite connection pool (rusqlite + Mutex)
    ├── src/ollama/         # Ollama HTTP client
    └── schema.sql          # SQLite schema — source of truth
```

**Frontend stack:** React 18, TypeScript (strict), Tailwind CSS v3, Zustand, Vite  
**Backend stack:** Rust, Tauri v2, rusqlite, serde, reqwest

#### SQLite Tables

| Table | Purpose |
|---|---|
| `workspaces` | Top-level multi-workspace |
| `projects` | Chat-only containers within a workspace |
| `chat_sessions` / `messages` / `citations` | Chat history + RAG citations |
| `concept_nodes` / `concept_links` / `concept_mentions` | Knowledge graph |
| `daily_notes` / `note_templates` | Notes + templates |
| `learning_cards` / `learning_paths` / `path_milestones` | Flashcards + SM-2 |
| `uploaded_documents` / `document_chunks` | Documents + embeddings |
| `web_captures` | Saved web pages |
| `audio_transcriptions` | Voice recordings |
| `calendar_alarms` | Scheduled reminders |
| `project_notes` | Workspace-scoped freeform notes |

---

### Swift App (macOS)

**Tech stack:** SwiftUI, SwiftData, Ollama HTTP, AVFoundation, Speech, Charts

```
Sources/Aetherium/
├── Models/        # @Model SwiftData entities
├── Views/         # SwiftUI views
├── Services/      # Business logic
├── Demo/          # Demo mode infrastructure
├── Managers/      # Theme, shortcuts
└── Plugins/       # Plugin system
```

#### Services

- **OllamaService** — AI model communication
- **ModelOrchestrator** — Model selection and routing
- **DocumentProcessor** — Text extraction, chunking, embedding
- **SemanticSearchEngine** — Vector similarity search
- **LinkingEngine** — Bidirectional `[[wiki-link]]` management
- **ConceptExtractor** — AI-powered concept detection
- **RetrievalEngine** — RAG retrieval
- **SpacedRepetitionEngine** — SM-2 algorithm
- **NoteTemplateEngine** — Template variable substitution
- **ExportEngine** — Markdown, Obsidian Vault, PDF, JSON
- **VoiceTranscriptionService** — macOS Speech framework
- **AIContentGenerator** — Auto-tagging, summaries, quizzes
- **BackupService** — Incremental backups with timeline
- **PluginManager** — Plugin discovery, loading, permissions
- **SecurityManager** — Biometric authentication

## 🔨 Build & Check

### Swift app
```bash
swift build     # compile
swift test      # run tests
```

### Tauri app
```bash
# TypeScript type-check
cd tauri
~/.nvm/versions/node/v20.19.5/bin/npx tsc --noEmit

# Rust type-check
~/.cargo/bin/cargo check --manifest-path tauri/src-tauri/Cargo.toml

# Development server
cd tauri
PATH="$HOME/.cargo/bin:$HOME/.nvm/versions/node/v20.19.5/bin:$PATH" npm run tauri dev
```

Both `cargo check` and `tsc --noEmit` must exit 0 before committing.

## 🎯 Roadmap

### Swift app — Phases 1–10: Complete ✅
- ✅ Foundation (Projects, Auth, Chat)
- ✅ Document Intelligence (RAG, Citations)
- ✅ Knowledge Graph (Bidirectional Links)
- ✅ Semantic Search (Ollama Embeddings)
- ✅ Smart Editor (Live Linking)
- ✅ Daily Notes (Templates, Calendar)
- ✅ Learning Intelligence (Spaced Repetition)
- ✅ Voice + Export (Speech, Multiple Formats)
- ✅ Dashboard + Analytics (AI Insights)
- ✅ Plugin System (7 plugin types, built-in plugins)

### Tauri app — In progress
- ✅ Core scaffold (Tauri v2, SQLite, React, Tailwind)
- ✅ All 20 views wired (chat, notes, graph, flashcards, documents, settings…)
- ✅ Rust service layer (linking engine, document processor, semantic search, RAG, backup…)
- ✅ Backlinks + `[[wiki-link]]` auto-indexing
- ✅ Workspace-scoped data model
- [ ] Full Ollama embedding pipeline (nomic-embed-text)
- [ ] Plugin system port
- [ ] Voice transcription (cross-platform)
- [ ] Multi-platform packages (Windows, Linux)

### Future (both apps)
- [ ] iCloud / cloud sync
- [ ] iOS companion app
- [ ] Collaboration features
- [ ] Plugin marketplace
- [ ] Multi-language support

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Ollama** - For making local AI accessible
- **Obsidian** - Inspiration for knowledge graph
- **NotebookLM** - Inspiration for source grounding
- **SuperMemo** - SM-2 algorithm for spaced repetition

## 📧 Contact

- **GitHub Issues** - For bugs and feature requests
- **Discussions** - For questions and community

---

**Built with ❤️ using Swift, Rust, React, and local-first AI principles**
