import Foundation
import SwiftData

// MARK: - WorkspaceGlossaryTerm
// Per-workspace terminology index. Mirrors Tauri `workspace_glossary_terms`.

@Model
final class WorkspaceGlossaryTerm {
    @Attribute(.unique) var id: UUID
    var term: String
    var definition: String
    var aliases: [String]           // alternative spellings / abbreviations
    var sourceSessionId: String?    // chat session this term was first seen in
    var isManual: Bool              // true = user-entered; false = AI-seeded
    var createdAt: Date
    var updatedAt: Date

    @Relationship(deleteRule: .nullify)
    var workspace: Workspace?

    init(
        id: UUID = UUID(),
        term: String,
        definition: String,
        aliases: [String] = [],
        sourceSessionId: String? = nil,
        isManual: Bool = true,
        workspace: Workspace? = nil
    ) {
        self.id = id
        self.term = term
        self.definition = definition
        self.aliases = aliases
        self.sourceSessionId = sourceSessionId
        self.isManual = isManual
        self.workspace = workspace
        self.createdAt = Date()
        self.updatedAt = Date()
    }

    func updateTimestamp() {
        self.updatedAt = Date()
    }
}
