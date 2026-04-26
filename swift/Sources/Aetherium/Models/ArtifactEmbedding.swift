import Foundation
import SwiftData

@Model
final class ArtifactEmbedding {
    @Attribute(.unique) var id: UUID
    var artifactId: UUID
    @Attribute(.externalStorage) var embeddingData: Data
    var model: String
    var createdAt: Date

    init(id: UUID = UUID(), artifactId: UUID, embeddingData: Data, model: String = "ollama") {
        self.id = id
        self.artifactId = artifactId
        self.embeddingData = embeddingData
        self.model = model
        self.createdAt = Date()
    }
}
