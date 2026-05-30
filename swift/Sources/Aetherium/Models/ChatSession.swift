import Foundation
import SwiftData

@Model
final class ChatSession {
    @Attribute(.unique) var id: UUID
    var title: String
    var createdAt: Date
    var updatedAt: Date
    var modelName: String
    var isLocal: Bool // Whether using Ollama or cloud API
    var lastProcessedMessageCount: Int

    // Flags and tracking parity with Tauri schema
    var isPinned: Bool
    var isIncognito: Bool
    var excludeFromAnalytics: Bool
    var isDeleted: Bool
    var deletedAt: Date?
    var lastAccessedAt: Date?
    var isImported: Bool
    var parentSessionID: UUID?
    var branchMessageID: UUID?

    @Relationship(deleteRule: .cascade) var messages: [Message]
    var project: Project?
    var workspace: Workspace? // For project-less chats attached directly to a workspace

    var systemPrompt: String?

    // Metadata for knowledge graph
    var extractedTopics: [String]
    var relatedGoalIDs: [String]

    // Branching support
    var parentMessageID: UUID? // The message this branch forked from
    var branchLabel: String? // e.g. "Branch from message #3"

    init(
        id: UUID = UUID(),
        title: String = "New Chat",
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        modelName: String = "",
        isLocal: Bool = true,
        systemPrompt: String? = nil,
        parentMessageID: UUID? = nil,
        branchLabel: String? = nil,
        lastProcessedMessageCount: Int = 0,
        isPinned: Bool = false,
        isIncognito: Bool = false,
        excludeFromAnalytics: Bool = false,
        isDeleted: Bool = false,
        deletedAt: Date? = nil,
        lastAccessedAt: Date? = nil,
        isImported: Bool = false,
        parentSessionID: UUID? = nil,
        branchMessageID: UUID? = nil
    ) {
        self.id = id
        self.title = title
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.modelName = modelName
        self.isLocal = isLocal
        self.systemPrompt = systemPrompt
        self.messages = []
        self.extractedTopics = []
        self.relatedGoalIDs = []
        self.parentMessageID = parentMessageID
        self.branchLabel = branchLabel
        self.lastProcessedMessageCount = lastProcessedMessageCount
        self.isPinned = isPinned
        self.isIncognito = isIncognito
        self.excludeFromAnalytics = excludeFromAnalytics
        self.isDeleted = isDeleted
        self.deletedAt = deletedAt
        self.lastAccessedAt = lastAccessedAt
        self.isImported = isImported
        self.parentSessionID = parentSessionID
        self.branchMessageID = branchMessageID
    }

    var needsAutoTitle: Bool {
        title == "New Chat"
    }

    func addMessage(content: String, role: MessageRole) {
        let message = Message(content: content, role: role)
        messages.append(message)
        updatedAt = Date()

        // Set a quick fallback title from the first user message
        if needsAutoTitle && role == .user && messages.count <= 2 {
            title = String(content.prefix(50))
        }
    }

    func getContextMessages(limit: Int = 20) -> [Message] {
        var context = Array(messages.suffix(limit))

        // Inject system prompt if present
        let promptToUse = systemPrompt
        if let prompt = promptToUse, !prompt.isEmpty {
            let sysMsg = Message(content: prompt, role: .system)
            context.insert(sysMsg, at: 0)
        }

        return context
    }

    /// Remove all messages after (and including) the given message, for edit/rerun flows.
    func truncateFrom(_ message: Message) {
        let sorted = messages.sorted(by: { $0.timestamp < $1.timestamp })
        guard let index = sorted.firstIndex(where: { $0.id == message.id }) else { return }
        let toRemove = sorted[index...]
        messages.removeAll { msg in toRemove.contains(where: { $0.id == msg.id }) }
        updatedAt = Date()
    }

    /// Create a branched copy of this session up to (but not including) the given message.
    func branch(upTo message: Message, modelContext: ModelContext) -> ChatSession {
        let sorted = messages.sorted(by: { $0.timestamp < $1.timestamp })
        let index = sorted.firstIndex(where: { $0.id == message.id }) ?? sorted.endIndex

        let branchSession = ChatSession(
            title: "\(title) (branch)",
            modelName: modelName,
            isLocal: isLocal,
            parentMessageID: message.id,
            branchLabel: "Branched at message #\(index + 1)"
        )
        branchSession.project = project
        branchSession.workspace = workspace
        branchSession.extractedTopics = extractedTopics
        branchSession.relatedGoalIDs = relatedGoalIDs

        modelContext.insert(branchSession)

        // Copy messages up to the branch point
        for msg in sorted.prefix(index) {
            let copy = Message(content: msg.content, role: msg.role, timestamp: msg.timestamp, tokenCount: msg.tokenCount)
            copy.chatSession = branchSession
            branchSession.messages.append(copy)
            modelContext.insert(copy)
        }

        return branchSession
    }
}

@Model
final class Message {
    @Attribute(.unique) var id: UUID
    var content: String
    var role: MessageRole
    var timestamp: Date
    var tokenCount: Int?
    // Parity fields
    var createdAt: Date
    var modelName: String?
    var tokensUsed: Int?
    var durationMs: Int?

    @Relationship(deleteRule: .cascade) var citations: [Citation]
    @Relationship(deleteRule: .cascade) var variants: [MessageVariant] = []
    var chatSession: ChatSession?

    init(
        id: UUID = UUID(),
        content: String,
        role: MessageRole,
        timestamp: Date = Date(),
        tokenCount: Int? = nil,
        createdAt: Date = Date(),
        modelName: String? = nil,
        tokensUsed: Int? = nil,
        durationMs: Int? = nil
    ) {
        self.id = id
        self.content = content
        self.role = role
        self.timestamp = timestamp
        self.tokenCount = tokenCount
        self.createdAt = createdAt
        self.modelName = modelName
        self.tokensUsed = tokensUsed
        self.durationMs = durationMs
        self.citations = []
        self.variants = []
    }
}

@Model
final class Citation {
    @Attribute(.unique) var id: UUID
    var sourceID: String // UUID of source document/chunk
    var sourceTitle: String
    var sourceType: String // document, webpage, note
    var excerpt: String
    var relevanceScore: Double
    var pageNumber: Int?

    var createdAt: Date

    var message: Message?

    init(
        id: UUID = UUID(),
        sourceID: String,
        sourceTitle: String,
        sourceType: String,
        excerpt: String,
        relevanceScore: Double,
        pageNumber: Int? = nil
    ) {
        self.id = id
        self.sourceID = sourceID
        self.sourceTitle = sourceTitle
        self.sourceType = sourceType
        self.excerpt = excerpt
        self.relevanceScore = relevanceScore
        self.pageNumber = pageNumber
        self.createdAt = Date()
    }
}

enum MessageRole: String, Codable {
    case system
    case user
    case assistant
}
