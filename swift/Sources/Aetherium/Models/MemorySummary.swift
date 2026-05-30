import Foundation
import SwiftData

// MARK: - MemorySummary
// Rolling AI-generated summary of workspace memories.
// Mirrors Tauri `memory_summaries` + `memory_summary_snapshots` tables.

@Model
final class MemorySummary {
    @Attribute(.unique) var id: UUID
    var content: String
    var isGlobal: Bool           // true = app-wide; false = workspace-scoped
    var generatedAt: Date
    var updatedAt: Date

    @Relationship(deleteRule: .nullify)
    var workspace: Workspace?

    @Relationship(deleteRule: .cascade, inverse: \MemorySummarySnapshot.summary)
    var snapshots: [MemorySummarySnapshot] = []

    init(
        id: UUID = UUID(),
        content: String,
        isGlobal: Bool = false,
        workspace: Workspace? = nil
    ) {
        self.id = id
        self.content = content
        self.isGlobal = isGlobal
        self.workspace = workspace
        self.generatedAt = Date()
        self.updatedAt = Date()
        self.snapshots = []
    }

    func updateTimestamp() {
        self.updatedAt = Date()
    }
}

// MARK: - MemorySummarySnapshot
// Point-in-time snapshot of a MemorySummary, enabling rollback.

@Model
final class MemorySummarySnapshot {
    @Attribute(.unique) var id: UUID
    var content: String
    var snapshotAt: Date

    @Relationship(deleteRule: .nullify)
    var summary: MemorySummary?

    init(id: UUID = UUID(), content: String, summary: MemorySummary? = nil) {
        self.id = id
        self.content = content
        self.snapshotAt = Date()
        self.summary = summary
    }
}
