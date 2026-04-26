import Foundation
import SwiftData

@Model
final class ConversationSummary {
    @Attribute(.unique) var id: UUID
    var summaryType: String // SummaryType.rawValue
    var content: String
    var keyTopics: [String]
    var messageRangeStart: Int
    var messageRangeEnd: Int
    var tokenCount: Int
    var createdAt: Date
    var updatedAt: Date

    // Relationships
    var workspace: Workspace?
    var chatSession: ChatSession?

    // Embeddings
    @Attribute(.externalStorage) var embeddingsData: Data?

    // In-memory cache
    @Transient var cachedEmbedding: [Float]?

    init(
        id: UUID = UUID(),
        summaryType: SummaryType = .rolling,
        content: String,
        keyTopics: [String] = [],
        messageRangeStart: Int,
        messageRangeEnd: Int,
        tokenCount: Int = 0,
        embeddings: [Float]? = nil
    ) {
        self.id = id
        self.summaryType = summaryType.rawValue
        self.content = content
        self.keyTopics = keyTopics
        self.messageRangeStart = messageRangeStart
        self.messageRangeEnd = messageRangeEnd
        self.tokenCount = tokenCount
        self.createdAt = Date()
        self.updatedAt = Date()

        if let embeddings = embeddings {
            self.embeddingsData = embeddings.withUnsafeBufferPointer { Data(buffer: $0) }
        }
    }

    var type: SummaryType {
        SummaryType(rawValue: summaryType) ?? .rolling
    }

    var embeddings: [Float]? {
        if let cached = cachedEmbedding { return cached }
        guard let data = embeddingsData else { return nil }
        let decoded = data.withUnsafeBytes { buffer in
            Array(buffer.bindMemory(to: Float.self))
        }
        cachedEmbedding = decoded
        return decoded
    }
}

enum SummaryType: String, Codable {
    case rolling
    case final
    case segment
}

@Model
final class ContextSnapshot {
    @Attribute(.unique) var id: UUID
    var messageId: String // Since Message might not be directly linkable yet without its own model or structure adjustment
    var assembledContext: String
    var tokenBudget: Int
    var tokensUsed: Int
    var sourcesJson: String
    var createdAt: Date

    // Relationships
    var chatSession: ChatSession?

    init(
        id: UUID = UUID(),
        messageId: String,
        assembledContext: String,
        tokenBudget: Int,
        tokensUsed: Int,
        sourcesJson: String = "{}"
    ) {
        self.id = id
        self.messageId = messageId
        self.assembledContext = assembledContext
        self.tokenBudget = tokenBudget
        self.tokensUsed = tokensUsed
        self.sourcesJson = sourcesJson
        self.createdAt = Date()
    }
}
