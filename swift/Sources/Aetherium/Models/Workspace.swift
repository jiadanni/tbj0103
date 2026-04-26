import Foundation
import SwiftData

@Model
final class Workspace {
    @Attribute(.unique) var id: UUID
    var title: String
    var workspaceDescription: String
    var createdAt: Date
    var updatedAt: Date

    @Relationship(deleteRule: .cascade) var learningGoals: [LearningGoal]
    @Relationship(deleteRule: .cascade) var projects: [Project] = []
    @Relationship(deleteRule: .cascade) var sources: [ProjectSource] = []
    @Relationship(deleteRule: .cascade) var dailyNotes: [DailyNote] = []
    @Relationship(deleteRule: .cascade) var learningCards: [LearningCard] = []
    @Relationship(deleteRule: .cascade) var concepts: [ConceptNode] = []
    @Relationship(deleteRule: .cascade) var directChatSessions: [ChatSession] = []

    init(
        id: UUID = UUID(),
        title: String,
        description: String,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.title = title
        self.workspaceDescription = description
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.learningGoals = []
        self.projects = []
        self.sources = []
        self.dailyNotes = []
        self.learningCards = []
        self.directChatSessions = []
    }

    /// All chat sessions across all projects in this workspace, plus project-less chats.
    var chatSessions: [ChatSession] {
        projects.flatMap { $0.chatSessions } + directChatSessions
    }

    func updateTimestamp() {
        self.updatedAt = Date()
    }
}
