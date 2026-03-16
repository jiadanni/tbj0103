import XCTest
import SwiftData
@testable import Aetherium

final class SpacedRepetitionEngineTests: XCTestCase {
    var engine: SpacedRepetitionEngine!
    var modelContainer: ModelContainer!
    var modelContext: ModelContext!
    var project: Workspace!

    @MainActor
    override func setUp() async throws {
        try await super.setUp()
        // Create an in-memory ModelContainer
        let schema = Schema([
            Workspace.self,
            LearningCard.self,
            ChatSession.self,
            LearningGoal.self,
            ProjectSource.self,
            NoteTemplate.self,
            DailyNote.self,
            LearningPath.self,
            PathMilestone.self,
            ConceptNode.self,
            ConceptLink.self,
            ConceptMention.self,
            UploadedDocument.self,
            DocumentChunk.self,
            WebCapture.self,
            AudioTranscription.self,
            ProjectNote.self,
            Message.self,
            Citation.self
        ])
        let configuration = ModelConfiguration(isStoredInMemoryOnly: true)
        modelContainer = try ModelContainer(for: schema, configurations: [configuration])
        modelContext = ModelContext(modelContainer)

        engine = SpacedRepetitionEngine(modelContext: modelContext)

        // Create a dummy project
        project = Workspace(title: "Test Project", description: "A test project")
        modelContext.insert(project)
    }

    override func tearDown() {
        engine = nil
        modelContainer = nil
        modelContext = nil
        project = nil
        super.tearDown()
    }

    @MainActor
    func testReviewCard_Correct() {
        // Create a learning card simulating one previous correct review
        let card = LearningCard(front: "Front", back: "Back")
        card.project = project
        card.repetitions = 1  // Second review: SM-2 sets interval to 6
        modelContext.insert(card)

        // Initial state check
        XCTAssertEqual(card.repetitions, 1)
        XCTAssertEqual(card.interval, 1)
        XCTAssertEqual(card.easeFactor, 2.5)

        // Review with perfect quality (5) — increases ease factor per SM-2 formula
        engine.reviewCard(card, quality: 5)

        // Verify state updates
        XCTAssertEqual(card.repetitions, 2)
        XCTAssertGreaterThan(card.interval, 1)      // SM-2: repetitions==1 → interval = 6
        XCTAssertGreaterThan(card.easeFactor, 2.5)  // Ease factor increases for perfect answers
    }

    @MainActor
    func testReviewCard_Incorrect() {
        // Create a learning card
        let card = LearningCard(front: "Front", back: "Back")
        card.project = project
        // Simulate previous successful reviews
        card.repetitions = 2
        card.interval = 6
        modelContext.insert(card)

        // Review with low quality (< 3)
        engine.reviewCard(card, quality: 1)

        // Verify state resets
        XCTAssertEqual(card.repetitions, 0)
        XCTAssertEqual(card.interval, 1)
        // Ease factor decreases but stays >= 1.3
        XCTAssertLessThan(card.easeFactor, 2.5)
        XCTAssertGreaterThanOrEqual(card.easeFactor, 1.3)
    }

    @MainActor
    func testLoadDueCards() {
        // Create a card due yesterday
        let dueCard = LearningCard(front: "Due", back: "Card")
        dueCard.project = project
        dueCard.nextReviewDate = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
        modelContext.insert(dueCard)

        // Create a card due tomorrow
        let futureCard = LearningCard(front: "Future", back: "Card")
        futureCard.project = project
        futureCard.nextReviewDate = Calendar.current.date(byAdding: .day, value: 1, to: Date())!
        modelContext.insert(futureCard)

        // Load due cards
        engine.loadDueCards(for: project)

        // Verify only dueCard is loaded
        XCTAssertTrue(engine.dueCards.contains { $0.id == dueCard.id })
        XCTAssertFalse(engine.dueCards.contains { $0.id == futureCard.id })
    }
}
