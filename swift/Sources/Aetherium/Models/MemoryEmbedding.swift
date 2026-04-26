import Foundation
import SwiftData

@Model
final class MemoryEmbedding {
    @Attribute(.unique) var id: UUID
    var memoryId: UUID
    @Attribute(.externalStorage) var embeddingData: Data
    var model: String
    var createdAt: Date

    init(id: UUID = UUID(), memoryId: UUID, embeddingData: Data, model: String = "ollama") {
        self.id = id
        self.memoryId = memoryId
        self.embeddingData = embeddingData
        self.model = model
        self.createdAt = Date()
    }
}
