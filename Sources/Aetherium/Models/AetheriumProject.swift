import Foundation
import SwiftData

@Model
final class AetheriumProject {
    @Attribute(.unique) var id: UUID
    var title: String
    var projectDescription: String
    var createdAt: Date
    var updatedAt: Date

    @Relationship(deleteRule: .cascade) var learningGoals: [LearningGoal]
    @Relationship(deleteRule: .cascade) var chatSessions: [ChatSession] = []
    @Relationship(deleteRule: .cascade) var sources: [ProjectSource] = []
    @Relationship(deleteRule: .cascade) var concepts: [ConceptNode] = []

    init(
        id: UUID = UUID(),
        title: String,
        description: String,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.title = title
        self.projectDescription = description
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.learningGoals = []
        self.chatSessions = []
        self.sources = []
    }

    func updateTimestamp() {
        self.updatedAt = Date()
    }
}
