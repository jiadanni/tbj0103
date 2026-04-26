import Foundation
import SwiftData

/// Orchestrates automatic generation of flashcards and knowledge graph concepts
/// whenever new content enters the system (documents, chat responses, notes).
@MainActor
class AutoContentGenerator {
    private let ollamaService: OllamaService
    private let modelContext: ModelContext

    init(ollamaService: OllamaService, modelContext: ModelContext) {
        self.ollamaService = ollamaService
        self.modelContext = modelContext
    }

    // MARK: - Document Auto-Generation

    /// Auto-generate flashcards and concepts from a newly processed document.
    /// Runs as fire-and-forget after the document is saved — errors are logged, not thrown.
    func processDocument(_ document: UploadedDocument, project: Workspace) async {
        let text = document.extractedText
        guard !text.isEmpty else { return }

        async let cardsTask: () = generateFlashcards(from: text, project: project)
        async let conceptsTask: () = extractAndInsertConcepts(from: text, project: project)

        _ = await (cardsTask, conceptsTask)
    }

    // MARK: - Chat Auto-Generation

    /// Auto-extract concepts from a chat exchange (user message + AI response).
    func processChatExchange(userMessage: String, aiResponse: String, project: Workspace?) async {
        guard let project else { return }
        let combined = "User: \(userMessage)\n\nAssistant: \(aiResponse)"
        await extractAndInsertConcepts(from: combined, project: project)
    }

    // MARK: - Note Auto-Generation

    /// Auto-generate flashcards and concepts when a note is saved.
    func processNote(_ note: ProjectNote, project: Workspace) async {
        let text = note.content
        guard !text.isEmpty else { return }

        async let cardsTask: () = generateFlashcards(from: text, project: project)
        async let conceptsTask: () = extractAndInsertConcepts(from: text, project: project)

        _ = await (cardsTask, conceptsTask)
    }

    // MARK: - Bulk Project Processing

    /// Process all existing sources in a project that haven't had cards/concepts generated yet.
    func processEntireProject(_ project: Workspace) async {
        // Process documents
        for source in project.sources {
            if let document = source.document {
                await processDocument(document, project: project)
            }
        }

        // Process chat sessions
        for chat in project.chatSessions {
            let conversation = chat.messages
                .sorted { $0.timestamp < $1.timestamp }
                .map { "\($0.role.rawValue): \($0.content)" }
                .joined(separator: "\n\n")
            guard !conversation.isEmpty else { continue }
            await extractAndInsertConcepts(from: conversation, project: project)
        }

        // Auto-link all concepts
        await autoLinkProjectConcepts(project)
    }

    // MARK: - Private Helpers

    private func generateFlashcards(from content: String, project: Workspace) async {
        do {
            let generator = AIContentGenerator(ollamaService: ollamaService, modelContext: modelContext)
            // Scale card count based on content length
            let wordCount = content.split(separator: " ").count
            let cardCount = min(max(wordCount / 200, 3), 10) // 3-10 cards
            let questions = try await generator.generateQuestions(from: content, count: cardCount)

            // Avoid duplicate cards — check existing fronts
            let existingCards = fetchExistingCardFronts(for: project)
            let newQuestions = questions.filter { q in
                !existingCards.contains(where: { existing in
                    existing.lowercased() == q.question.lowercased()
                })
            }

            guard !newQuestions.isEmpty else { return }
            generator.createFlashcardsFromQuestions(newQuestions, project: project)
        } catch {
            // Non-fatal: log and continue
            print("[AutoContentGenerator] Flashcard generation failed: \(error.localizedDescription)")
        }
    }

    private func extractAndInsertConcepts(from content: String, project: Workspace) async {
        do {
            let generator = AIContentGenerator(ollamaService: ollamaService, modelContext: modelContext)
            let wordCount = content.split(separator: " ").count
            let maxConcepts = min(max(wordCount / 100, 3), 15) // 3-15 concepts
            let extracted = try await generator.extractConcepts(from: content, project: project, maxConcepts: maxConcepts)
            generator.createConceptsInProject(extracted, project: project)
        } catch {
            print("[AutoContentGenerator] Concept extraction failed: \(error.localizedDescription)")
        }
    }

    private func autoLinkProjectConcepts(_ project: Workspace) async {
        let linkingEngine = LinkingEngine(modelContext: modelContext)
        let orchestrator = ModelOrchestrator(ollamaService: ollamaService)
        let extractor = ConceptExtractor(modelOrchestrator: orchestrator, linkingEngine: linkingEngine)
        await extractor.autoLinkConcepts(project.concepts)
    }

    private func fetchExistingCardFronts(for project: Workspace) -> [String] {
        let projectId = project.id
        let descriptor = FetchDescriptor<LearningCard>(
            predicate: #Predicate { card in
                card.project?.id == projectId
            }
        )
        return (try? modelContext.fetch(descriptor))?.map(\.front) ?? []
    }
}
