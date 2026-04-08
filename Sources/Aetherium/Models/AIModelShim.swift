import Foundation
import SwiftData

@Model
final class AIModel {
    @Attribute(.unique) var id: String // maps to `id` or `model_id`
    var name: String
    var modelId: String?
    var provider: String
    var roleTags: [String]
    var priority: Int
    var isPaid: Bool
    var enabled: Bool
    var tokensUsedTotal: Int
    var createdAt: Date

    init(
        id: String = UUID().uuidString,
        name: String = "",
        modelId: String? = nil,
        provider: String = "ollama",
        roleTags: [String] = [],
        priority: Int = 0,
        isPaid: Bool = false,
        enabled: Bool = true,
        tokensUsedTotal: Int = 0
    ) {
        self.id = id
        self.name = name
        self.modelId = modelId
        self.provider = provider
        self.roleTags = roleTags
        self.priority = priority
        self.isPaid = isPaid
        self.enabled = enabled
        self.tokensUsedTotal = tokensUsedTotal
        self.createdAt = Date()
    }
}
