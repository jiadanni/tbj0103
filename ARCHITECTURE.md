# Aetherium Architecture

This document describes the technical architecture of Aetherium, a local-first AI learning companion.

## Design Principles

### 1. Privacy First
- All sensitive data stored locally with encryption
- Biometric authentication required for access
- Local AI models preferred over cloud APIs
- No telemetry or tracking

### 2. Project-Centric Organization
- Every chat belongs to a project
- Projects contain learning goals
- Goals can have prerequisites and dependencies
- Knowledge graph connects related concepts

### 3. Hybrid AI Processing
- Prefer local models (Ollama) for privacy and cost
- Automatic fallback to cloud APIs for complex queries
- Transparent model switching based on context window
- User control over model preferences

### 4. Apple Platform Native
- Pure SwiftUI for modern, reactive UI
- SwiftData for persistence (Core Data successor)
- LocalAuthentication for biometrics
- Follows Apple HIG guidelines

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Aetherium App                         │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   SwiftUI    │  │  Security    │  │    Model     │  │
│  │    Views     │  │   Manager    │  │ Orchestrator │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                  │                  │          │
│         └──────────────────┼──────────────────┘          │
│                            │                             │
│  ┌─────────────────────────┴──────────────────────────┐ │
│  │              Service Layer                         │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  ┌──────────────┐  ┌──────────────┐              │ │
│  │  │   Ollama     │  │    Future:   │              │ │
│  │  │   Service    │  │  Cloud APIs  │              │ │
│  │  └──────────────┘  └──────────────┘              │ │
│  └────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐│
│  │              Data Layer (SwiftData)                  ││
│  ├─────────────────────────────────────────────────────┤│
│  │  AetheriumProject │ ChatSession │ LearningGoal     ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
           │                        │
           ▼                        ▼
   ┌──────────────┐        ┌──────────────┐
   │    Ollama    │        │   SwiftData  │
   │  (localhost) │        │  SQLite DB   │
   └──────────────┘        └──────────────┘
```

## Component Details

### Views Layer

#### AuthenticationView
- Entry point requiring biometric authentication
- Detects available biometric type (Touch ID / Face ID / Optic ID)
- Blocks access until successful authentication
- Clean, minimal UI following Apple design

#### ContentView
- Three-column NavigationSplitView
- Column 1: Project list
- Column 2: Chat sessions + learning goals
- Column 3: Active chat interface
- Adaptive layout for different window sizes

#### ProjectListView
- Displays all projects sorted by recent activity
- Shows project metadata (# chats, # goals)
- Context menu for edit/delete
- Creates new projects via sheet

#### ChatSessionListView
- Two sections: Conversations & Learning Goals
- Shows chat metadata (model, last updated, local/cloud)
- Progress bars for learning goals
- Quick access to create new chats/goals

#### ChatView
- Message list with user/assistant bubbles
- Auto-scrolling to latest message
- Input field with multi-line support
- Model switcher in toolbar
- Export and clear history options

### Services Layer

#### OllamaService
**Responsibility**: Interface with local Ollama instance

```swift
class OllamaService {
    func checkAvailability() -> Bool
    func fetchAvailableModels() -> [OllamaModel]
    func sendMessage(
        content: String,
        model: String,
        context: [Message]
    ) -> String
}
```

**Key Features**:
- Health check endpoint ping
- Model listing from Ollama
- Non-streaming chat completions
- Error handling for service unavailable
- Future: Streaming support

**API Integration**:
- Endpoint: `http://localhost:11434`
- `/api/tags` - List models
- `/api/chat` - Send chat messages
- `/api/generate` - Single completions

#### SecurityManager
**Responsibility**: Handle biometric authentication

```swift
class SecurityManager {
    @Published var isAuthenticated: Bool
    @Published var biometricType: BiometricType

    func authenticate() async throws
    func logout()
}
```

**Features**:
- Automatic biometric type detection
- LocalAuthentication framework integration
- Fallback to password if biometrics fail
- Auto-lock support (planned)

#### ModelOrchestrator
**Responsibility**: Choose between local and cloud models

```swift
class ModelOrchestrator {
    @Published var preferLocalModels: Bool
    @Published var currentModel: ModelConfiguration

    func processMessage(
        content: String,
        context: [Message]
    ) async throws -> String
}
```

**Logic Flow**:
1. Estimate token count for message + context
2. If `preferLocalModels` && within context window → Use Ollama
3. Else → Fallback to cloud API (future)
4. Handle errors and retry logic

**Token Estimation**:
- Simple: ~4 chars per token
- Could be improved with tiktoken-style tokenizer
- Used to prevent context window overflow

### Data Models Layer

#### AetheriumProject
**The Top-Level Container**

```swift
@Model
final class AetheriumProject {
    var id: UUID
    var title: String
    var projectDescription: String
    var learningGoals: [LearningGoal]
    var chatSessions: [ChatSession]
    var createdAt: Date
    var updatedAt: Date
}
```

**Relationships**:
- One-to-many: Project → ChatSessions
- One-to-many: Project → LearningGoals
- Cascade delete: Deleting project removes all children

#### ChatSession
**Individual Conversation**

```swift
@Model
final class ChatSession {
    var id: UUID
    var title: String
    var modelName: String
    var isLocal: Bool
    var messages: [Message]
    var extractedTopics: [String]
    var relatedGoalIDs: [String]
    var project: AetheriumProject?
}
```

**Key Methods**:
- `addMessage(content, role)` - Appends message and updates timestamp
- `getContextMessages(limit)` - Returns last N messages for API context
- Auto-generates title from first user message

**Knowledge Graph Fields**:
- `extractedTopics`: AI-extracted concepts (future)
- `relatedGoalIDs`: Links to relevant learning goals

#### Message
**Individual Chat Message**

```swift
@Model
final class Message {
    var id: UUID
    var content: String
    var role: MessageRole  // system, user, assistant
    var timestamp: Date
    var tokenCount: Int?
    var chatSession: ChatSession?
}
```

**Simple and Clean**:
- Stores message content and metadata
- Role determines display style
- Token count for usage tracking (optional)

#### LearningGoal
**Trackable Learning Objective**

```swift
@Model
final class LearningGoal {
    var id: UUID
    var title: String
    var goalDescription: String
    var progress: Double  // 0.0 to 1.0
    var prerequisiteIDs: [String]
    var relatedChatIDs: [String]
    var project: AetheriumProject?
}
```

**Key Features**:
- Progress tracking (0-100%)
- Prerequisite dependencies (goal graph)
- Linked to relevant chat sessions
- Methods to update progress and add relationships

## Data Flow

### User Sends a Message

```
1. User types in ChatInputView
2. ChatView.sendMessage() called
   ↓
3. chatSession.addMessage(userMessage, role: .user)
   → Saves to SwiftData immediately
   ↓
4. ModelOrchestrator.processMessage(userMessage, context)
   ↓
5. OllamaService.sendMessage(userMessage, model, context)
   → HTTP POST to localhost:11434/api/chat
   ↓
6. Ollama processes locally, returns response
   ↓
7. chatSession.addMessage(response, role: .assistant)
   → Saves to SwiftData
   ↓
8. UI updates automatically (via @ObservedObject)
```

### SwiftData Auto-Save

SwiftData automatically:
- Persists changes to SQLite
- Encrypts data at rest
- Handles undo/redo
- Syncs to iCloud (if enabled)
- Provides efficient queries

### Reactive UI Updates

```
SwiftData Model Change
    ↓
@Model publishes change
    ↓
@Query in View refreshes
    ↓
SwiftUI re-renders affected views
```

No manual refresh needed - fully reactive!

## Future Enhancements

### Phase 2: Knowledge Graph

```swift
class KnowledgeGraphManager {
    func extractEntities(from chats: [ChatSession]) -> [Entity]
    func findRelatedConcepts(for topic: String) -> [Concept]
    func suggestLearningPath(
        for goal: LearningGoal
    ) -> [LearningStep]
}
```

**Implementation Ideas**:
- Use local embedding models for semantic search
- Named entity recognition on chat history
- Build graph database of concepts
- Visualize with force-directed graph

### Phase 3: Cloud API Integration

```swift
protocol CloudAIService {
    func sendMessage(
        content: String,
        context: [Message]
    ) async throws -> String
}

class OpenAIService: CloudAIService { ... }
class AnthropicService: CloudAIService { ... }
class PerplexityService: CloudAIService { ... }
```

**Features**:
- API key management (Keychain)
- Usage tracking and cost estimation
- Model comparison tool
- Automatic failover

### Phase 4: Browser Integration

```swift
class MCPBridge {
    func exportToClaudeAI(project: AetheriumProject)
    func importFromChatGPT() -> AetheriumProject
    func syncWithPerplexity(bidirectional: Bool)
}
```

**Concept**:
- Browser extension for Claude.ai, ChatGPT, etc.
- Export projects to continue in browser
- Import interesting threads back to Aetherium
- Sync learning goals across platforms

## Security Considerations

### Data Protection

1. **Biometric Lock**: Required on every launch
2. **Encrypted Storage**: SwiftData encryption at rest
3. **No Telemetry**: Zero data leaves the device (unless user enables iCloud)
4. **Local Models**: Conversations never touch cloud (when using Ollama)

### Network Security

1. **Localhost Only**: Ollama on 127.0.0.1
2. **No External Connections**: Without user permission
3. **API Keys**: Stored in Keychain (when cloud APIs added)
4. **Certificate Pinning**: For cloud API calls (future)

### Code Security

1. **Input Validation**: Sanitize all user inputs
2. **SQL Injection**: Protected by SwiftData ORM
3. **XSS Prevention**: Not applicable (native app)
4. **Sandboxing**: macOS app sandbox enabled

## Performance Optimization

### SwiftData Optimizations

1. **Lazy Loading**: Use `@Query` with filters
2. **Pagination**: Limit message history queries
3. **Indexes**: On frequently queried fields
4. **Batch Updates**: For bulk operations

### UI Optimizations

1. **LazyVStack**: For long message lists
2. **ScrollViewReader**: Efficient scrolling to bottom
3. **Debouncing**: On search and filter inputs
4. **Image Caching**: For future avatar support

### Memory Management

1. **Context Limits**: Trim old messages from API context
2. **Model Unloading**: Free Ollama models when inactive
3. **Cache Invalidation**: Clear old SwiftData caches

## Testing Strategy

### Unit Tests
- Model logic (LearningGoal progress updates)
- Service methods (Ollama API calls)
- Token estimation accuracy

### Integration Tests
- SwiftData persistence
- Ollama connection and responses
- Biometric authentication flow

### UI Tests
- Navigation between views
- Message sending and receiving
- Project CRUD operations

## Deployment

### Development Build
```bash
swift build
swift run Aetherium
```

### Release Build
```bash
swift build -c release
```

### Distribution Options
1. **Direct Download**: .app bundle from GitHub releases
2. **Homebrew**: `brew install aetherium`
3. **Mac App Store**: (requires paid developer account)

## Conclusion

Aetherium's architecture prioritizes:
- **Privacy**: Local-first, biometric security
- **User Control**: Explicit model choices
- **Performance**: Native Swift, efficient data layer
- **Extensibility**: Clear service boundaries for future features

The project is structured for long-term growth while maintaining a clean, understandable codebase.
