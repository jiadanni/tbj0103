import Foundation
import SwiftData

// MARK: - Folder
// Mirrors Tauri `folders` table. Folders are workspace-level containers that
// group chat sessions with optional custom instructions, colour, and icon.

@Model
final class Folder {
    @Attribute(.unique) var id: UUID
    var title: String
    var folderDescription: String
    var colorHex: String          // e.g. "#FF6B6B"
    var iconName: String          // SF Symbol name
    var customInstructions: String
    var sortOrder: Int
    var createdAt: Date
    var updatedAt: Date

    @Relationship(deleteRule: .nullify, inverse: \Workspace.folders)
    var workspace: Workspace?

    @Relationship(deleteRule: .nullify)
    var chatSessions: [ChatSession] = []

    init(
        id: UUID = UUID(),
        title: String,
        description: String = "",
        colorHex: String = "#6B7280",
        iconName: String = "folder.fill",
        customInstructions: String = "",
        sortOrder: Int = 0
    ) {
        self.id = id
        self.title = title
        self.folderDescription = description
        self.colorHex = colorHex
        self.iconName = iconName
        self.customInstructions = customInstructions
        self.sortOrder = sortOrder
        self.createdAt = Date()
        self.updatedAt = Date()
        self.chatSessions = []
    }

    func updateTimestamp() {
        self.updatedAt = Date()
    }
}
