import Foundation
import SwiftData

@Model
final class AIModelEntity {
    @Attribute(.unique) var id: String // Usually the model_id
    var name: String
    var provider: String
    var roleTags: [String]
    var priority: Int
    var isPaid: Bool
    var enabled: Bool
    var tokensUsedTotal: Int
    var createdAt: Date

    init(
        id: String,
        name: String,
        provider: String = "ollama",
        roleTags: [String] = [],
        priority: Int = 0,
        isPaid: Bool = false,
        enabled: Bool = true,
        tokensUsedTotal: Int = 0
    ) {
        self.id = id
        self.name = name
        self.provider = provider
        self.roleTags = roleTags
        self.priority = priority
        self.isPaid = isPaid
        self.enabled = enabled
        self.tokensUsedTotal = tokensUsedTotal
        self.createdAt = Date()
    }
}
