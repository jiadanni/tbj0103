# Aetherium

> **Your local-first AI learning companion**

Aetherium is a comprehensive macOS application that combines ChatGPT-style conversations, NotebookLM's source grounding, Obsidian's knowledge graphs, and Notion's organization—all powered by local Ollama AI models for complete privacy.

![Swift](https://img.shields.io/badge/Swift-5.9-orange.svg)
![SwiftUI](https://img.shields.io/badge/SwiftUI-macOS%2014+-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## ✨ Features

### 🤖 AI Chat with Source Grounding
- Converse with local Ollama models (qwen2.5:7b, llama3, etc.)
- **Source-grounded responses** with automatic citations
- Upload documents (PDF, TXT, Markdown, HTML, RTF) for RAG
- Capture web pages and audio transcriptions
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

### Prerequisites

- **macOS 14.0+** (Sonoma or later)
- **Xcode 15.0+**
- **Ollama** installed and running ([ollama.ai](https://ollama.ai))

### Ollama Setup

```bash
# Install Ollama
brew install ollama

# Start Ollama service
ollama serve

# Pull required models
ollama pull qwen2.5:7b
ollama pull nomic-embed-text
```

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/aetherium.git
   cd aetherium
   ```

2. **Open in Xcode**
   ```bash
   open Package.swift
   ```

3. **Build and Run**
   - Select your Mac as the run destination
   - Press `Cmd+R` to build and run

### First Launch

1. **Authenticate** with Touch ID / Face ID
2. **Create your first project**
3. **Start learning!**

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

### Tech Stack

- **SwiftUI** - Modern declarative UI
- **SwiftData** - Core Data replacement with modern API
- **Ollama** - Local AI models
- **Speech Framework** - Voice transcription
- **Charts** - Data visualization
- **AVFoundation** - Audio processing

### Data Models

```
AetheriumProject
├── ChatSession
│   └── Message
│       └── Citation
├── ProjectSource
│   ├── UploadedDocument
│   │   └── DocumentChunk (with embeddings)
│   ├── WebCapture
│   ├── AudioTranscription
│   └── ProjectNote
├── ConceptNode
│   ├── ConceptLink
│   └── ConceptMention
├── LearningGoal
├── LearningPath
│   └── PathMilestone
├── LearningCard (flashcards)
├── DailyNote
└── NoteTemplate
```

### Services

- **OllamaService** - AI model communication
- **ModelOrchestrator** - Model selection and routing
- **DocumentProcessor** - Extract text, chunk, embed
- **EmbeddingGenerator** - Generate vectors with Ollama
- **SemanticSearchEngine** - Vector similarity search
- **LinkingEngine** - Bidirectional link management
- **ConceptExtractor** - AI-powered concept detection
- **GroundedChatEngine** - RAG implementation
- **SpacedRepetitionEngine** - SM-2 algorithm
- **NoteTemplateEngine** - Template processing
- **ExportEngine** - Multi-format export
- **VoiceTranscriptionService** - Speech-to-text
- **AIContentGenerator** - Auto-tagging, summaries, questions
- **PluginManager** - Plugin discovery, loading, and management
- **SecurityManager** - Biometric authentication

## 🎯 Roadmap

### Phase 1-10: Complete ✅
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

### Future Enhancements (Phase 11+)
- [ ] iCloud sync
- [ ] iOS companion app
- [ ] Collaboration features
- [ ] Plugin store with community plugins
- [ ] Custom AI model fine-tuning
- [ ] Advanced graph algorithms (PageRank, clustering)
- [ ] Multi-language support
- [ ] Themes and customization
- [ ] Mobile-optimized plugin API

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

**Built with ❤️ using Swift and local-first AI principles**
