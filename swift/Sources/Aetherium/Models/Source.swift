import Foundation
import SwiftData

@Model
final class Source {
    @Attribute(.unique) var id: UUID
    var workspace: Workspace?
    var sourceType: String
    var title: String
    var filename: String?
    var fileType: String?
    var fileSize: Int64?
    var url: String?
    var content: String?
    var summary: String?
    var faviconData: Data?
    var isProcessed: Bool
    var folder: String?
    var tokenCount: Int?
    var createdAt: Date
    var updatedAt: Date?

    init(
        id: UUID = UUID(),
        sourceType: String,
        title: String,
        filename: String? = nil
    ) {
        self.id = id
        self.sourceType = sourceType
        self.title = title
        self.filename = filename
        self.isProcessed = false
        self.createdAt = Date()
    }
}
