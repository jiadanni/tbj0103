import Foundation
import SwiftData

@Model
final class ThoughtQueueItem {
    @Attribute(.unique) var id: UUID
    var content: String
    var status: String // ThoughtStatus.rawValue
    var processAt: Date?
    var modelName: String
    var promptPrefix: String
    var result: String?
    var resultAt: Date?
    var createdAt: Date
    var updatedAt: Date

    // Relationships
    var workspace: Workspace?

    init(
        id: UUID = UUID(),
        content: String,
        status: ThoughtStatus = .pending,
        processAt: Date? = nil,
        modelName: String = "",
        promptPrefix: String = ""
    ) {
        self.id = id
        self.content = content
        self.status = status.rawValue
        self.processAt = processAt
        self.modelName = modelName
        self.promptPrefix = promptPrefix
        self.createdAt = Date()
        self.updatedAt = Date()
    }

    var currentStatus: ThoughtStatus {
        ThoughtStatus(rawValue: status) ?? .pending
    }
}

enum ThoughtStatus: String, Codable {
    case pending
    case scheduled
    case processing
    case done
}
