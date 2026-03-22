import Foundation
import SwiftData

@Model
final class Memory {
    @Attribute(.unique) var id: UUID
    var projectId: String
    var content: String
    var memoryType: String // MemoryType.rawValue
    var sourceSessionId: String?
    var isPinned: Bool
    var isActive: Bool
    var createdAt: Date
    var updatedAt: Date

    // Relationships
    var workspace: Workspace?

    // Embeddings
    @Attribute(.externalStorage) var embeddingsData: Data?

    // In-memory cache
    @Transient var cachedEmbedding: [Float]?

    init(
        id: UUID = UUID(),
        projectId: String = "",
        content: String,
        memoryType: MemoryType = .fact,
        sourceSessionId: String? = nil,
        isPinned: Bool = false,
        isActive: Bool = true,
        embeddings: [Float]? = nil
    ) {
        self.id = id
        self.projectId = projectId
        self.content = content
        self.memoryType = memoryType.rawValue
        self.sourceSessionId = sourceSessionId
        self.isPinned = isPinned
        self.isActive = isActive
        self.createdAt = Date()
        self.updatedAt = Date()

        if let embeddings = embeddings {
            self.embeddingsData = embeddings.withUnsafeBufferPointer { Data(buffer: $0) }
        }
    }

    var type: MemoryType {
        MemoryType(rawValue: memoryType) ?? .fact
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

enum MemoryType: String, Codable {
    case fact
    case preference
    case context
}
