import Foundation
import SwiftData

// MARK: - AI Content Generator

@MainActor
class AIContentGenerator: ObservableObject {
    @Published var isGenerating = false
    @Published var progress: Double = 0.0

    private let ollamaService: OllamaService
    private let modelContext: ModelContext

    init(ollamaService: OllamaService, modelContext: ModelContext) {
        self.ollamaService = ollamaService
        self.modelContext = modelContext
    }

    // MARK: - Auto-Tagging

    /// Generate relevant tags for content using AI
    func generateTags(for content: String, maxTags: Int = 5) async throws -> [String] {
        let prompt = """
        Analyze the following content and generate up to \(maxTags) relevant tags.
        Return only the tags as a comma-separated list, no explanations.

        Content:
        \(content.prefix(1000))

        Tags:
        """

        let response = try await ollamaService.sendMessage(
            prompt,
            model: "qwen2.5:7b"
        )

        // Parse tags from response
        let tags = response
            .components(separatedBy: ",")
            .map { $0.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .prefix(maxTags)

        return Array(tags)
    }

    // MARK: - Smart Summaries

    /// Generate a concise summary of content
    func generateSummary(
        for content: String,
        style: SummaryStyle = .concise,
        maxLength: Int = 200
    ) async throws -> String {
        let stylePrompt: String
        switch style {
        case .concise:
            stylePrompt = "Create a brief, concise summary in 2-3 sentences."
        case .detailed:
            stylePrompt = "Create a comprehensive summary covering all key points."
        case .bulletPoints:
            stylePrompt = "Create a summary using bullet points for each key point."
        case .abstract:
            stylePrompt = "Create an academic-style abstract."
        }

        let prompt = """
        \(stylePrompt)

        Content to summarize:
        \(content)

        Summary:
        """

        let response = try await ollamaService.sendMessage(
            prompt,
            model: "qwen2.5:7b"
        )

        return response.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
    }

    // MARK: - Concept Extraction

    /// Extract key concepts from content
    func extractConcepts(
        from content: String,
        project: AetheriumProject,
        maxConcepts: Int = 10
    ) async throws -> [ExtractedConcept] {
        isGenerating = true
        progress = 0.0

        defer {
            isGenerating = false
            progress = 0.0
        }

        let prompt = """
        Analyze the following content and extract the key concepts, ideas, and topics.
        For each concept, provide:
        1. The concept name (2-4 words)
        2. A brief description (1 sentence)
        3. The concept type (topic, technology, person, definition, question, insight, resource, or custom)

        Format your response as JSON array:
        [
          {"name": "Concept Name", "description": "Brief description", "type": "topic"},
          ...
        ]

        Content:
        \(content)

        Concepts (JSON):
        """

        progress = 0.3

        let response = try await ollamaService.sendMessage(
            prompt,
            model: "qwen2.5:7b"
        )

        progress = 0.6

        // Parse JSON response
        guard let jsonData = extractJSON(from: response),
              let concepts = try? JSONDecoder().decode([ExtractedConcept].self, from: jsonData) else {
            throw AIGeneratorError.parsingFailed
        }

        progress = 1.0

        return Array(concepts.prefix(maxConcepts))
    }

    /// Create ConceptNodes from extracted concepts
    func createConceptsInProject(
        _ extractedConcepts: [ExtractedConcept],
        project: AetheriumProject
    ) {
        for extracted in extractedConcepts {
            // Check if concept already exists
            let exists = project.concepts.contains(where: { concept in
                concept.name.lowercased() == extracted.name.lowercased()
            })

            guard !exists else { continue }

            // Create new concept
            let concept = ConceptNode(
                name: extracted.name,
                description: extracted.description,
                nodeType: extracted.typeEnum
            )
            concept.project = project

            modelContext.insert(concept)
        }
    }

    // MARK: - Question Generation

    /// Generate study questions from content
    func generateQuestions(
        from content: String,
        count: Int = 5,
        difficulty: QuestionDifficulty = .medium
    ) async throws -> [GeneratedQuestion] {
        isGenerating = true
        progress = 0.0

        defer {
            isGenerating = false
            progress = 0.0
        }

        let difficultyPrompt: String
        switch difficulty {
        case .easy:
            difficultyPrompt = "simple recall questions"
        case .medium:
            difficultyPrompt = "understanding and application questions"
        case .hard:
            difficultyPrompt = "analysis and synthesis questions"
        }

        let prompt = """
        Generate \(count) \(difficultyPrompt) based on the following content.
        Format your response as JSON array:
        [
          {
            "question": "The question text",
            "answer": "The answer",
            "type": "recall|understanding|application|analysis",
            "difficulty": "easy|medium|hard"
          },
          ...
        ]

        Content:
        \(content)

        Questions (JSON):
        """

        progress = 0.3

        let response = try await ollamaService.sendMessage(
            prompt,
            model: "qwen2.5:7b"
        )

        progress = 0.6

        // Parse JSON response
        guard let jsonData = extractJSON(from: response),
              let questions = try? JSONDecoder().decode([GeneratedQuestion].self, from: jsonData) else {
            throw AIGeneratorError.parsingFailed
        }

        progress = 1.0

        return Array(questions.prefix(count))
    }

    /// Create flashcards from generated questions
    func createFlashcardsFromQuestions(
        _ questions: [GeneratedQuestion],
        project: AetheriumProject
    ) {
        for question in questions {
            let card = LearningCard(
                front: question.question,
                back: question.answer,
                cardType: .basic,
                difficulty: question.difficultyLevel,
                tags: ["ai-generated", question.type]
            )
            card.project = project

            modelContext.insert(card)
        }
    }

    // MARK: - Key Points Extraction

    /// Extract key points from document
    func extractKeyPoints(
        from content: String,
        count: Int = 5
    ) async throws -> [String] {
        let prompt = """
        Extract the \(count) most important key points from the following content.
        Return them as a numbered list.

        Content:
        \(content)

        Key Points:
        """

        let response = try await ollamaService.sendMessage(
            prompt,
            model: "qwen2.5:7b"
        )

        // Parse numbered list
        let points = response
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines) }
            .filter { $0.hasPrefix("1") || $0.hasPrefix("2") || $0.hasPrefix("3") || $0.hasPrefix("4") || $0.hasPrefix("5") }
            .map { point in
                // Remove number prefix
                let cleaned = point.replacingOccurrences(of: "^[0-9]+\\.?\\s*", with: "", options: String.CompareOptions.regularExpression)
                return cleaned
            }
            .filter { !$0.isEmpty }

        return Array(points.prefix(count))
    }

    // MARK: - Study Guide Generation

    /// Generate a study guide from content
    func generateStudyGuide(from content: String) async throws -> StudyGuide {
        let prompt = """
        Create a comprehensive study guide based on the following content.
        Include: overview, key concepts, important points, and study tips.
        Format as JSON:
        {
          "title": "Study Guide Title",
          "overview": "Brief overview",
          "keyConcepts": ["concept1", "concept2", ...],
          "importantPoints": ["point1", "point2", ...],
          "studyTips": ["tip1", "tip2", ...]
        }

        Content:
        \(content)

        Study Guide (JSON):
        """

        let response = try await ollamaService.sendMessage(
            prompt,
            model: "qwen2.5:7b"
        )

        guard let jsonData = extractJSON(from: response),
              let studyGuide = try? JSONDecoder().decode(StudyGuide.self, from: jsonData) else {
            throw AIGeneratorError.parsingFailed
        }

        return studyGuide
    }

    // MARK: - Helpers

    private func extractJSON(from text: String) -> Data? {
        // Try to find JSON array or object in response
        let patterns = [
            "\\[.*\\]", // Array
            "\\{.*\\}"  // Object
        ]

        for pattern in patterns {
            if let regex = try? NSRegularExpression(pattern: pattern, options: .dotMatchesLineSeparators),
               let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
               let range = Range(match.range, in: text) {
                let jsonString = String(text[range])
                return jsonString.data(using: .utf8)
            }
        }

        // Try the whole text
        return text.data(using: .utf8)
    }
}

// MARK: - Supporting Types

struct ExtractedConcept: Codable {
    let name: String
    let description: String
    let type: String

    var typeEnum: ConceptNodeType {
        ConceptNodeType(rawValue: type) ?? .topic
    }
}

struct GeneratedQuestion: Codable {
    let question: String
    let answer: String
    let type: String // recall, understanding, application, analysis
    let difficulty: String // easy, medium, hard

    var difficultyLevel: Int {
        switch difficulty.lowercased() {
        case "easy": return 2
        case "hard": return 4
        default: return 3
        }
    }
}

struct StudyGuide: Codable {
    let title: String
    let overview: String
    let keyConcepts: [String]
    let importantPoints: [String]
    let studyTips: [String]
}

enum SummaryStyle {
    case concise
    case detailed
    case bulletPoints
    case abstract
}

enum QuestionDifficulty {
    case easy
    case medium
    case hard
}

enum AIGeneratorError: Error, LocalizedError {
    case parsingFailed
    case generationFailed
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .parsingFailed:
            return "Failed to parse AI response"
        case .generationFailed:
            return "Failed to generate content"
        case .invalidResponse:
            return "Invalid response from AI model"
        }
    }
}
