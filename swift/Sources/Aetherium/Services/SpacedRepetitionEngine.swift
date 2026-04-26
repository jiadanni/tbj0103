import Foundation
import SwiftData

// MARK: - Spaced Repetition Engine (SM-2 Algorithm)

@MainActor
class SpacedRepetitionEngine: ObservableObject {
    @Published var dueCards: [LearningCard] = []
    @Published var reviewStats: ReviewStats?

    private let modelContext: ModelContext

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
    }

    // MARK: - Card Review

    /// Process card review with quality rating
    /// - Parameter quality: 0-5 scale (0 = total blackout, 5 = perfect response)
    func reviewCard(_ card: LearningCard, quality: Int) {
        let quality = max(0, min(5, quality)) // Clamp to 0-5

        // SM-2 Algorithm
        if quality >= 3 {
            // Correct response
            card.correctReviews += 1

            if card.repetitions == 0 {
                card.interval = 1
            } else if card.repetitions == 1 {
                card.interval = 6
            } else {
                card.interval = Int(Double(card.interval) * card.easeFactor)
            }

            card.repetitions += 1
        } else {
            // Incorrect response - reset
            card.repetitions = 0
            card.interval = 1
        }

        // Update ease factor
        let qualityFactor = Double(quality)
        card.easeFactor += (0.1 - (5.0 - qualityFactor) * (0.08 + (5.0 - qualityFactor) * 0.02))

        // Minimum ease factor is 1.3
        card.easeFactor = max(1.3, card.easeFactor)

        // Set next review date
        card.nextReviewDate = Calendar.current.date(byAdding: .day, value: card.interval, to: Date()) ?? Date()
        card.lastReviewDate = Date()
        card.totalReviews += 1

        // Update due cards
        loadDueCards(for: card.project)
    }

    // MARK: - Card Management

    /// Get due cards for review
    func loadDueCards(for project: Workspace?) {
        guard let project = project else {
            dueCards = []
            return
        }

        let now = Date()
        let projectId = project.id
        let descriptor = FetchDescriptor<LearningCard>(
            predicate: #Predicate { card in
                card.project?.id == projectId &&
                card.nextReviewDate <= now
            },
            sortBy: [SortDescriptor(\.nextReviewDate)]
        )

        dueCards = (try? modelContext.fetch(descriptor)) ?? []
    }

    /// Get all cards for project
    func getAllCards(for project: Workspace) -> [LearningCard] {
        let projectId = project.id
        let descriptor = FetchDescriptor<LearningCard>(
            predicate: #Predicate { card in
                card.project?.id == projectId
            },
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )

        return (try? modelContext.fetch(descriptor)) ?? []
    }

    /// Create card from concept
    func createCardFromConcept(_ concept: ConceptNode, project: Workspace) -> LearningCard {
        let card = LearningCard(
            front: "What is \(concept.name)?",
            back: concept.conceptDescription ?? "No description available",
            cardType: .basic,
            tags: [concept.type.rawValue]
        )
        card.concept = concept
        card.project = project

        modelContext.insert(card)
        return card
    }

    /// Generate AI-powered flashcards from note content
    func generateCardsFromNote(
        _ note: ProjectNote,
        project: Workspace,
        ollamaService: OllamaService,
        count: Int = 5
    ) async -> [LearningCard] {
        do {
            let generator = AIContentGenerator(ollamaService: ollamaService, modelContext: modelContext)
            let questions = try await generator.generateQuestions(from: note.content, count: count)
            generator.createFlashcardsFromQuestions(questions, project: project)
            return getAllCards(for: project).suffix(count).reversed()
        } catch {
            return []
        }
    }

    // MARK: - Statistics

    /// Calculate review statistics
    func calculateStats(for project: Workspace) -> ReviewStats {
        let allCards = getAllCards(for: project)

        let totalCards = allCards.count
        let dueNow = allCards.filter { $0.nextReviewDate <= Date() }.count
        let dueToday = allCards.filter { card in
            Calendar.current.isDateInToday(card.nextReviewDate)
        }.count

        let totalReviews = allCards.reduce(0) { $0 + $1.totalReviews }
        let correctReviews = allCards.reduce(0) { $0 + $1.correctReviews }
        let accuracy = totalReviews > 0 ? Double(correctReviews) / Double(totalReviews) : 0.0

        let masteredCards = allCards.filter { $0.repetitions >= 5 && $0.easeFactor >= 2.5 }.count

        return ReviewStats(
            totalCards: totalCards,
            dueNow: dueNow,
            dueToday: dueToday,
            totalReviews: totalReviews,
            accuracy: accuracy,
            masteredCards: masteredCards,
            averageEaseFactor: allCards.isEmpty ? 0.0 : allCards.map { $0.easeFactor }.reduce(0, +) / Double(allCards.count)
        )
    }

    /// Get review history for past days
    func getReviewHistory(days: Int = 7, project: Workspace) -> [ReviewDay] {
        let allCards = getAllCards(for: project)
        var history: [ReviewDay] = []

        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())

        for dayOffset in 0..<days {
            guard let date = calendar.date(byAdding: .day, value: -dayOffset, to: today) else { continue }

            let reviewsOnDay = allCards.filter { card in
                guard let lastReview = card.lastReviewDate else { return false }
                return calendar.isDate(lastReview, inSameDayAs: date)
            }.count

            history.append(ReviewDay(date: date, reviews: reviewsOnDay))
        }

        return history.reversed()
    }
}

// MARK: - Supporting Types

struct ReviewStats {
    let totalCards: Int
    let dueNow: Int
    let dueToday: Int
    let totalReviews: Int
    let accuracy: Double
    let masteredCards: Int
    let averageEaseFactor: Double

    var retentionRate: Double {
        guard totalCards > 0 else { return 0.0 }
        return Double(masteredCards) / Double(totalCards)
    }
}

struct ReviewDay: Identifiable {
    let id = UUID()
    let date: Date
    let reviews: Int
}

// MARK: - Leitner System (Alternative)

/// Alternative spaced repetition system using boxes
class LeitnerSystem {
    private let boxIntervals = [1, 3, 7, 14, 30] // Days for each box

    func getBoxInterval(_ box: Int) -> Int {
        let index = max(0, min(box, boxIntervals.count - 1))
        return boxIntervals[index]
    }

    func promoteCard(_ card: LearningCard) {
        let currentBox = card.difficulty
        let newBox = min(currentBox + 1, 5)
        card.difficulty = newBox
        card.interval = getBoxInterval(newBox)
        card.nextReviewDate = Calendar.current.date(byAdding: .day, value: card.interval, to: Date()) ?? Date()
    }

    func demoteCard(_ card: LearningCard) {
        card.difficulty = 1
        card.interval = 1
        card.nextReviewDate = Date()
    }
}
