import Foundation
import SwiftData

@Model
final class Artifact {
    @Attribute(.unique) var id: UUID
    var title: String
    var artifactType: String // ArtifactType.rawValue
    var language: String
    var content: String
    var artifactDescription: String
    var tags: [String]
    var isPinned: Bool
    var version: Int
    var tokenCount: Int
    var createdAt: Date
    var updatedAt: Date

    // Relationships
    var workspace: Workspace?
    var chatSession: ChatSession?
    
    // We can't directly map to a specific message ID simply if we don't have the Message model imported, 
    // but assuming ChatSession has it. For now, store as String:
    var messageId: String?
    var parentArtifactId: String?

    // Embeddings
    @Attribute(.externalStorage) var embeddingsData: Data?

    // In-memory cache
    @Transient var cachedEmbedding: [Float]?

    init(
        id: UUID = UUID(),
        title: String,
        artifactType: ArtifactType = .code,
        language: String = "",
        content: String,
        description: String = "",
        tags: [String] = [],
        isPinned: Bool = false,
        version: Int = 1,
        tokenCount: Int = 0,
        messageId: String? = nil,
        parentArtifactId: String? = nil,
        embeddings: [Float]? = nil
    ) {
        self.id = id
        self.title = title
        self.artifactType = artifactType.rawValue
        self.language = language
        self.content = content
        self.artifactDescription = description
        self.tags = tags
        self.isPinned = isPinned
        self.version = version
        self.tokenCount = tokenCount
        self.messageId = messageId
        self.parentArtifactId = parentArtifactId
        self.createdAt = Date()
        self.updatedAt = Date()

        if let embeddings = embeddings {
            self.embeddingsData = embeddings.withUnsafeBufferPointer { Data(buffer: $0) }
        }
    }

    var type: ArtifactType {
        ArtifactType(rawValue: artifactType) ?? .other
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

enum ArtifactType: String, Codable {
    case code
    case document
    case diagram
    case config
    case data
    case other
}
