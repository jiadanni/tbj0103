import Foundation
import SwiftData

@Model
final class SourceChunk {
    @Attribute(.unique) var id: UUID
    var source: Source?
    var content: String
    var chunkIndex: Int
    @Attribute(.externalStorage) var embeddingData: Data?
    var createdAt: Date

    init(
        id: UUID = UUID(),
        content: String,
        chunkIndex: Int,
        embedding: [Float]? = nil
    ) {
        self.id = id
        self.content = content
        self.chunkIndex = chunkIndex
        self.createdAt = Date()
        if let embedding = embedding {
            self.embeddingData = embedding.withUnsafeBufferPointer { Data(buffer: $0) }
        }
    }
}
