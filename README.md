# Aetherium

> A local-first AI learning companion for macOS that treats conversations as interconnected knowledge nodes

Aetherium is a revolutionary approach to AI chat applications, designed specifically for deep learning and knowledge building. Unlike traditional chat apps where conversations exist in isolation, Aetherium organizes everything around **projects** and **learning goals**, creating a connected knowledge graph from your interactions.

## Core Philosophy

The key insight: **Chats should be project-aware and goal-oriented, not isolated conversations.**

Traditional AI chat apps treat each conversation as standalone. Aetherium instead:
- Organizes chats into **Projects** (e.g., "Learning SwiftUI", "Building a Compiler")
- Tracks **Learning Goals** with progress and prerequisites
- Builds a **Knowledge Graph** connecting related concepts across chats
- Uses **local models** via Ollama for privacy and cost-efficiency
- Provides **seamless fallback** to cloud APIs when needed

## Features

### Phase 1 (Current Implementation)

- **Project-Based Organization**: Group related chats and learning goals
- **Biometric Security**: Touch ID / Face ID protection for your private conversations
- **Local AI via Ollama**: Run models like Qwen 2.5, Llama 3.2, Mistral locally
- **Hybrid Model Support**: Automatic fallback to cloud APIs (planned)
- **Clean macOS-Native UI**: Built with SwiftUI for native performance
- **Persistent Storage**: SwiftData for efficient, encrypted local storage

### Phase 2 (Planned)

- **Knowledge Graph Visualization**: See connections between concepts
- **Smart Learning Paths**: AI-suggested next steps based on goals
- **Cross-Chat Search**: Find information across all project conversations
- **Topic Extraction**: Automatic tagging and categorization
- **Progress Tracking**: Visual progress for learning goals
- **Export/Import**: Share projects and integrate with other tools

### Phase 3 (Future)

- **MCP-Style Browser Integration**: Connect with ChatGPT, Claude, Perplexity
- **Advanced Model Orchestration**: Intelligent routing between models
- **Collaborative Projects**: Share and collaborate on learning projects
- **Custom Plugins**: Extend functionality with Swift packages

## Architecture

### Tech Stack

- **Language**: Swift 5.9+
- **UI Framework**: SwiftUI
- **Data Persistence**: SwiftData with CloudKit sync
- **Security**: LocalAuthentication framework
- **Local AI**: Ollama REST API
- **Minimum macOS**: 14.0 (Sonoma)

### Project Structure

```
Aetherium/
├── Sources/Aetherium/
│   ├── AetheriumApp.swift          # App entry point
│   ├── Models/
│   │   ├── AetheriumProject.swift  # Project data model
│   │   ├── ChatSession.swift       # Chat session & messages
│   │   └── LearningGoal.swift      # Learning goal tracking
│   ├── Services/
│   │   ├── OllamaService.swift     # Ollama API integration
│   │   ├── SecurityManager.swift   # Biometric authentication
│   │   └── ModelOrchestrator.swift # Model selection & routing
│   └── Views/
│       ├── AuthenticationView.swift
│       ├── ContentView.swift
│       ├── ProjectListView.swift
│       ├── ChatSessionListView.swift
│       └── ChatView.swift
├── Tests/AetheriumTests/
└── Package.swift
```

### Data Models

#### AetheriumProject
```swift
@Model
final class AetheriumProject {
    var id: UUID
    var title: String
    var description: String
    var learningGoals: [LearningGoal]
    var chatSessions: [ChatSession]
    var createdAt: Date
    var updatedAt: Date
}
```

#### ChatSession
```swift
@Model
final class ChatSession {
    var id: UUID
    var title: String
    var modelName: String
    var isLocal: Bool
    var messages: [Message]
    var extractedTopics: [String]  // For knowledge graph
    var relatedGoalIDs: [String]
}
```

#### LearningGoal
```swift
@Model
final class LearningGoal {
    var id: UUID
    var title: String
    var description: String
    var progress: Double  // 0.0 to 1.0
    var prerequisiteIDs: [String]  // Goal dependencies
    var relatedChatIDs: [String]   // Connected conversations
}
```

## Setup

### Prerequisites

1. **macOS 14.0+** (Sonoma or later)
2. **Xcode 15.0+**
3. **Ollama** installed and running

### Installing Ollama

```bash
# Install Ollama
brew install ollama

# Start Ollama service
ollama serve

# Pull a model (in a new terminal)
ollama pull qwen2.5:7b
ollama pull llama3.2
```

### Building Aetherium

```bash
# Clone the repository
git clone <repository-url>
cd aetherium

# Open in Xcode
open Package.swift

# Or build from command line
swift build

# Run the app
swift run Aetherium
```

### First Launch

1. **Authenticate**: Use Touch ID / Face ID to unlock
2. **Create a Project**: Click "New Project" in the sidebar
3. **Start a Chat**: Click "+" and select your local model
4. **Begin Learning**: Ask questions, set goals, track progress

## Usage

### Creating a Project

Projects organize related learning:

```
Example: "Learning iOS Development"
├── Chat: "SwiftUI Basics"
├── Chat: "Combine Framework"
├── Goal: "Build my first app"
└── Goal: "Understand reactive programming"
```

### Model Selection

Aetherium supports multiple Ollama models:
- **qwen2.5:7b** - Excellent for general learning (recommended)
- **llama3.2** - Good balance of speed and quality
- **mistral** - Fast responses, good for quick questions
- **codellama** - Specialized for coding help

### Biometric Security

All data is protected:
- **Authentication Required**: On every launch
- **Local Storage**: Encrypted with SwiftData
- **No Cloud Sync** (unless you enable iCloud)

## Development Roadmap

### Q1 2025
- [x] Core architecture and data models
- [x] Ollama integration
- [x] Basic chat interface
- [x] Project management
- [ ] Knowledge graph extraction
- [ ] Topic analysis using local models

### Q2 2025
- [ ] Cloud API fallback (OpenAI, Anthropic)
- [ ] Advanced search across projects
- [ ] Learning path suggestions
- [ ] Progress visualization

### Q3 2025
- [ ] Browser integration (MCP-style)
- [ ] Export/import functionality
- [ ] Plugin system
- [ ] iOS companion app

## Why Aetherium?

### The Problem with Current AI Chat Apps

1. **Isolated Conversations**: Each chat is independent
2. **No Learning Context**: Apps don't understand your goals
3. **Privacy Concerns**: All data goes to the cloud
4. **No Knowledge Building**: Insights are lost in history
5. **Expensive**: API costs add up quickly

### The Aetherium Solution

1. **Project Consciousness**: Every chat knows its context
2. **Goal-Oriented**: Track learning objectives and progress
3. **Privacy-First**: Local models + biometric security
4. **Knowledge Graph**: Connect ideas across conversations
5. **Cost-Effective**: Free local models, optional cloud fallback

## Technical Highlights

### Ollama Integration

```swift
// Send a message to local Ollama instance
let response = try await ollamaService.sendMessage(
    "Explain closures in Swift",
    model: "qwen2.5:7b",
    context: previousMessages,
    temperature: 0.7
)
```

### Biometric Security

```swift
// Authenticate user on launch
try await securityManager.authenticate()
```

### Model Orchestration

```swift
// Automatically choose between local and cloud
let response = try await modelOrchestrator.processMessage(
    userInput,
    context: chatHistory
)
// Uses Ollama if available, falls back to API if needed
```

## Contributing

Aetherium is in active development. Contributions welcome!

### Areas for Contribution

- **Knowledge Graph**: Implement entity extraction from chats
- **Streaming Support**: Add streaming responses from Ollama
- **Cloud APIs**: Integrate OpenAI, Anthropic, Perplexity
- **UI/UX**: Enhance the interface and user experience
- **Testing**: Write unit and integration tests

## License

MIT License - see LICENSE file for details

## Acknowledgments

- **Ollama** for making local AI accessible
- **Apple** for SwiftUI and SwiftData
- The open-source AI community

---

**Aetherium**: Because learning should be connected, private, and purposeful.
