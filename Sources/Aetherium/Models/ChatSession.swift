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

    @Relationship(deleteRule: .cascade) var messages: [Message]
    var project: AetheriumProject?

    // Metadata for knowledge graph
    var extractedTopics: [String]
    var relatedGoalIDs: [String]

    init(
        id: UUID = UUID(),
        title: String = "New Chat",
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        modelName: String = "qwen2.5:7b",
        isLocal: Bool = true
    ) {
        self.id = id
        self.title = title
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.modelName = modelName
        self.isLocal = isLocal
        self.messages = []
        self.extractedTopics = []
        self.relatedGoalIDs = []
    }

    func addMessage(content: String, role: MessageRole) {
        let message = Message(content: content, role: role)
        messages.append(message)
        updatedAt = Date()

        // Auto-generate title from first user message if still default
        if title == "New Chat" && role == .user && messages.count <= 2 {
            title = String(content.prefix(50))
        }
    }

    func getContextMessages(limit: Int = 20) -> [Message] {
        Array(messages.suffix(limit))
    }
}

@Model
final class Message {
    @Attribute(.unique) var id: UUID
    var content: String
    var role: MessageRole
    var timestamp: Date
    var tokenCount: Int?

    var chatSession: ChatSession?

    init(
        id: UUID = UUID(),
        content: String,
        role: MessageRole,
        timestamp: Date = Date(),
        tokenCount: Int? = nil
    ) {
        self.id = id
        self.content = content
        self.role = role
        self.timestamp = timestamp
        self.tokenCount = tokenCount
    }
}

enum MessageRole: String, Codable {
    case system
    case user
    case assistant
}
