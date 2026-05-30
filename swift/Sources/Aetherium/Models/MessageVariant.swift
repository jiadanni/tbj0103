import Foundation
import SwiftData

// MARK: - MessageVariant
// Stores alternate AI responses to the same user message without deleting
// the conversation history. Mirrors Tauri `message_variants` concept.

@Model
final class MessageVariant {
    @Attribute(.unique) var id: UUID
    var content: String
    var modelName: String?
    var isSelected: Bool      // true = currently displayed variant
    var generatedAt: Date
    var tokensUsed: Int?
    var durationMs: Int?

    @Relationship(deleteRule: .nullify)
    var message: Message?

    init(
        id: UUID = UUID(),
        content: String,
        modelName: String? = nil,
        isSelected: Bool = false,
        tokensUsed: Int? = nil,
        durationMs: Int? = nil,
        message: Message? = nil
    ) {
        self.id = id
        self.content = content
        self.modelName = modelName
        self.isSelected = isSelected
        self.generatedAt = Date()
        self.tokensUsed = tokensUsed
        self.durationMs = durationMs
        self.message = message
    }
}
