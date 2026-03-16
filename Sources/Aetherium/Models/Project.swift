import Foundation
import SwiftData

@Model
final class Project {
    @Attribute(.unique) var id: UUID
    var title: String
    var customInstructions: String
    var createdAt: Date
    var updatedAt: Date

    @Relationship(deleteRule: .cascade) var chatSessions: [ChatSession] = []
    @Relationship(deleteRule: .cascade) var documents: [ProjectSource] = []
    var workspace: Workspace?

    init(
        id: UUID = UUID(),
        title: String,
        customInstructions: String = "",
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.title = title
        self.customInstructions = customInstructions
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.chatSessions = []
        self.documents = []
    }

    func updateTimestamp() {
        self.updatedAt = Date()
    }
}
