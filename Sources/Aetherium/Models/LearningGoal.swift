import Foundation
import SwiftData

@Model
final class LearningGoal {
    @Attribute(.unique) var id: UUID
    var title: String
    var goalDescription: String
    var progress: Double
    var createdAt: Date
    var updatedAt: Date

    // Reference to parent project
    var project: Workspace?

    // Store prerequisite IDs as strings (SwiftData limitation workaround)
    var prerequisiteIDs: [String]
    var relatedChatIDs: [String]

    init(
        id: UUID = UUID(),
        title: String,
        description: String,
        progress: Double = 0.0,
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        prerequisiteIDs: [String] = [],
        relatedChatIDs: [String] = []
    ) {
        self.id = id
        self.title = title
        self.goalDescription = description
        self.progress = progress
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.prerequisiteIDs = prerequisiteIDs
        self.relatedChatIDs = relatedChatIDs
    }

    var prerequisites: [UUID] {
        prerequisiteIDs.compactMap { UUID(uuidString: $0) }
    }

    func addPrerequisite(_ goalID: UUID) {
        if !prerequisiteIDs.contains(goalID.uuidString) {
            prerequisiteIDs.append(goalID.uuidString)
            updatedAt = Date()
        }
    }

    func addRelatedChat(_ chatID: UUID) {
        if !relatedChatIDs.contains(chatID.uuidString) {
            relatedChatIDs.append(chatID.uuidString)
            updatedAt = Date()
        }
    }

    func updateProgress(_ newProgress: Double) {
        progress = min(max(newProgress, 0.0), 1.0)
        updatedAt = Date()
    }
}
