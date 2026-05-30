import Foundation
import SwiftData

@Model
final class Workspace {
    @Attribute(.unique) var id: UUID
    var title: String
    var workspaceDescription: String
    var isHidden: Bool
    var sortOrder: Int
    var createdAt: Date
    var updatedAt: Date

    @Relationship(deleteRule: .nullify, inverse: \Workspace.childWorkspaces)
    var parentWorkspace: Workspace?

    @Relationship(deleteRule: .nullify, inverse: \Workspace.parentWorkspace)
    var childWorkspaces: [Workspace] = []

    @Relationship(deleteRule: .cascade) var folders: [Folder] = []
    @Relationship(deleteRule: .cascade) var glossaryTerms: [WorkspaceGlossaryTerm] = []
    @Relationship(deleteRule: .cascade) var memorySummaries: [MemorySummary] = []
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
        isHidden: Bool = false,
        sortOrder: Int = 0,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.title = title
        self.workspaceDescription = description
        self.isHidden = isHidden
        self.sortOrder = sortOrder
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.parentWorkspace = nil
        self.childWorkspaces = []
        self.folders = []
        self.glossaryTerms = []
        self.memorySummaries = []
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

    var isRootWorkspace: Bool {
        parentWorkspace == nil
    }

    var sortedChildWorkspaces: [Workspace] {
        childWorkspaces.sorted { lhs, rhs in
            if lhs.sortOrder == rhs.sortOrder {
                return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
            }
            return lhs.sortOrder < rhs.sortOrder
        }
    }

    func updateTimestamp() {
        self.updatedAt = Date()
    }
}
