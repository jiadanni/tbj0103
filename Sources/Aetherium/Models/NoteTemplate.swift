import Foundation
import SwiftData

// MARK: - Note Template Model

@Model
final class NoteTemplate {
    @Attribute(.unique) var id: UUID
    var name: String
    var templateDescription: String?
    var content: String
    var category: String // TemplateCategory.rawValue
    var isBuiltIn: Bool
    var createdAt: Date
    var tags: [String]
    var variables: [String] // Variable names like {{date}}, {{project}}

    var project: Workspace?

    init(
        id: UUID = UUID(),
        name: String,
        description: String? = nil,
        content: String,
        category: TemplateCategory = .general,
        isBuiltIn: Bool = false,
        tags: [String] = [],
        variables: [String] = []
    ) {
        self.id = id
        self.name = name
        self.templateDescription = description
        self.content = content
        self.category = category.rawValue
        self.isBuiltIn = isBuiltIn
        self.createdAt = Date()
        self.tags = tags
        self.variables = variables
    }

    func categoryEnum() -> TemplateCategory {
        TemplateCategory(rawValue: category) ?? .general
    }
}

// MARK: - Daily Note Model

@Model
final class DailyNote {
    @Attribute(.unique) var id: UUID
    var date: Date
    var content: String
    var mood: String? // Mood tracking
    var productivity: Int? // 1-10 scale
    var completedTasks: [String]
    var learningHighlights: [String]
    var gratitude: [String]
    var createdAt: Date
    var updatedAt: Date

    var project: Workspace?
    var note: ProjectNote?

    init(
        id: UUID = UUID(),
        date: Date = Date(),
        content: String = "",
        mood: String? = nil,
        productivity: Int? = nil
    ) {
        self.id = id
        self.date = Self.normalizeDate(date)
        self.content = content
        self.mood = mood
        self.productivity = productivity
        self.completedTasks = []
        self.learningHighlights = []
        self.gratitude = []
        self.createdAt = Date()
        self.updatedAt = Date()
    }

    func updateTimestamp() {
        updatedAt = Date()
    }

    // Normalize date to midnight for consistent daily notes
    static func normalizeDate(_ date: Date) -> Date {
        Calendar.current.startOfDay(for: date)
    }
}

// MARK: - Learning Card (Flashcard)

@Model
final class LearningCard {
    @Attribute(.unique) var id: UUID
    var front: String
    var back: String
    var cardType: String // CardType.rawValue
    var difficulty: Int // 1-5
    var tags: [String]

    // Spaced Repetition (SM-2 Algorithm)
    var easeFactor: Double
    var interval: Int // Days until next review
    var repetitions: Int
    var nextReviewDate: Date
    var lastReviewDate: Date?
    var totalReviews: Int
    var correctReviews: Int

    var createdAt: Date
    var concept: ConceptNode?
    var project: Workspace?

    init(
        id: UUID = UUID(),
        front: String,
        back: String,
        cardType: CardType = .basic,
        difficulty: Int = 3,
        tags: [String] = []
    ) {
        self.id = id
        self.front = front
        self.back = back
        self.cardType = cardType.rawValue
        self.difficulty = difficulty
        self.tags = tags

        // SM-2 defaults
        self.easeFactor = 2.5
        self.interval = 1
        self.repetitions = 0
        self.nextReviewDate = Date()
        self.lastReviewDate = nil
        self.totalReviews = 0
        self.correctReviews = 0

        self.createdAt = Date()
    }

    func cardTypeEnum() -> CardType {
        CardType(rawValue: cardType) ?? .basic
    }
}

// MARK: - Learning Path

@Model
final class LearningPath {
    @Attribute(.unique) var id: UUID
    var title: String
    var pathDescription: String?
    var targetCompletionDate: Date?
    var isCompleted: Bool
    var createdAt: Date
    var completedAt: Date?

    @Relationship(deleteRule: .cascade) var milestones: [PathMilestone]
    var project: Workspace?

    init(
        id: UUID = UUID(),
        title: String,
        description: String? = nil,
        targetCompletionDate: Date? = nil
    ) {
        self.id = id
        self.title = title
        self.pathDescription = description
        self.targetCompletionDate = targetCompletionDate
        self.isCompleted = false
        self.createdAt = Date()
        self.completedAt = nil
        self.milestones = []
    }

    var progress: Double {
        guard !milestones.isEmpty else { return 0.0 }
        let completed = milestones.filter { $0.isCompleted }.count
        return Double(completed) / Double(milestones.count)
    }
}

@Model
final class PathMilestone {
    @Attribute(.unique) var id: UUID
    var title: String
    var milestoneDescription: String?
    var orderIndex: Int
    var isCompleted: Bool
    var completedAt: Date?
    var dueDate: Date?

    var learningPath: LearningPath?
    var relatedConcepts: [ConceptNode]

    init(
        id: UUID = UUID(),
        title: String,
        description: String? = nil,
        orderIndex: Int = 0,
        dueDate: Date? = nil
    ) {
        self.id = id
        self.title = title
        self.milestoneDescription = description
        self.orderIndex = orderIndex
        self.isCompleted = false
        self.completedAt = nil
        self.dueDate = dueDate
        self.relatedConcepts = []
    }

    func complete() {
        isCompleted = true
        completedAt = Date()
    }
}

// MARK: - Supporting Types

enum TemplateCategory: String, Codable, CaseIterable {
    case daily = "Daily"
    case meeting = "Meeting"
    case learning = "Learning"
    case project = "Project"
    case retrospective = "Retrospective"
    case general = "General"

    var icon: String {
        switch self {
        case .daily: return "calendar"
        case .meeting: return "person.3"
        case .learning: return "book"
        case .project: return "folder"
        case .retrospective: return "arrow.triangle.2.circlepath"
        case .general: return "doc.text"
        }
    }
}

enum CardType: String, Codable {
    case basic = "Basic"
    case cloze = "Cloze Deletion"
    case reversed = "Reversed"
    case multipleChoice = "Multiple Choice"
}
