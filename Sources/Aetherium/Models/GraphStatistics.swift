import Foundation
import SwiftData

@Model
final class GraphStatistics {
    @Attribute(.unique) var id: UUID
    var workspace: Workspace?
    var totalConcepts: Int
    var totalLinks: Int
    var avgDegree: Double
    var density: Double
    var updatedAt: Date

    init(
        id: UUID = UUID(),
        totalConcepts: Int = 0,
        totalLinks: Int = 0,
        avgDegree: Double = 0.0,
        density: Double = 0.0,
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.totalConcepts = totalConcepts
        self.totalLinks = totalLinks
        self.avgDegree = avgDegree
        self.density = density
        self.updatedAt = updatedAt
    }
}
