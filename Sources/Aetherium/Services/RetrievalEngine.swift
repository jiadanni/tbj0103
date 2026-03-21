import Foundation
import os
import SwiftData

// MARK: - Retrieval-Augmented Generation (RAG) Engine

@MainActor
class RetrievalEngine: ObservableObject {
    private let ollamaService: OllamaService
    private let similarityThreshold: Float = 0.7
    private let logger = Logger(subsystem: "com.aetherium.app", category: "RetrievalEngine")

    init(ollamaService: OllamaService) {
        self.ollamaService = ollamaService
    }

    /// Find relevant document chunks for a given query
    func findRelevantChunks(
        _ query: String,
        in project: Workspace,
        limit: Int = 5
    ) async -> [RetrievalResult] {
        // Get all document chunks from project sources
        let allChunks = getAllChunksFromProject(project)

        guard !allChunks.isEmpty else {
            return []
        }

        // Try semantic search first
        do {
            let queryEmbedding = try await ollamaService.generateEmbedding(query)
            let results = semanticRetrieval(
                queryEmbedding: queryEmbedding,
                chunks: allChunks,
                limit: limit
            )

            // If we got results, use them
            if !results.isEmpty {
                return results
            }
        } catch {
            logger.warning("Semantic search failed, falling back to keyword search: \(error)")
        }

        // Fallback to keyword matching
        let results = keywordBasedRetrieval(query: query, chunks: allChunks, limit: limit)

        return results
    }

    /// Retrieve chunks using semantic similarity (requires embeddings)
    func semanticRetrieval(
        queryEmbedding: [Float],
        chunks: [(chunk: DocumentChunk, sourceTitle: String, sourceType: ProjectSourceType)],
        limit: Int
    ) -> [RetrievalResult] {
        var scoredChunks: [(chunk: DocumentChunk, sourceTitle: String, sourceType: ProjectSourceType, score: Float)] = []

        for (chunk, sourceTitle, sourceType) in chunks {
            guard let chunkEmbedding = chunk.embeddings else { continue }

            let similarity = cosineSimilarity(queryEmbedding, chunkEmbedding)

            if similarity >= similarityThreshold {
                scoredChunks.append((chunk, sourceTitle, sourceType, similarity))
            }
        }

        // Sort by similarity score (descending)
        scoredChunks.sort { $0.score > $1.score }

        return scoredChunks.prefix(limit).map { item in
            RetrievalResult(
                chunk: item.chunk,
                sourceTitle: item.sourceTitle,
                sourceType: item.sourceType,
                relevanceScore: Double(item.score)
            )
        }
    }

    /// Fallback keyword-based retrieval (no embeddings needed)
    private func keywordBasedRetrieval(
        query: String,
        chunks: [(chunk: DocumentChunk, sourceTitle: String, sourceType: ProjectSourceType)],
        limit: Int
    ) -> [RetrievalResult] {
        let queryTerms = query.lowercased().split(separator: " ").map(String.init)

        var scoredChunks: [(chunk: DocumentChunk, sourceTitle: String, sourceType: ProjectSourceType, score: Double)] = []

        for (chunk, sourceTitle, sourceType) in chunks {
            let chunkText = chunk.content.lowercased()
            var score: Double = 0

            // Calculate score based on keyword matches
            for term in queryTerms {
                if chunkText.contains(term) {
                    // Count occurrences
                    let occurrences = chunkText.components(separatedBy: term).count - 1
                    score += Double(occurrences)
                }
            }

            if score > 0 {
                // Normalize by chunk length
                score = score / Double(chunk.content.count) * 1000
                scoredChunks.append((chunk, sourceTitle, sourceType, score))
            }
        }

        // Sort by score
        scoredChunks.sort { $0.score > $1.score }

        return scoredChunks.prefix(limit).map { item in
            RetrievalResult(
                chunk: item.chunk,
                sourceTitle: item.sourceTitle,
                sourceType: item.sourceType,
                relevanceScore: min(item.score / 10.0, 1.0) // Normalize to 0-1
            )
        }
    }

    /// Get all chunks from project sources
    private func getAllChunksFromProject(
        _ project: Workspace
    ) -> [(chunk: DocumentChunk, sourceTitle: String, sourceType: ProjectSourceType)] {
        var allChunks: [(DocumentChunk, String, ProjectSourceType)] = []

        for source in project.sources {
            let sourceType = source.type

            // Extract chunks based on source type
            switch sourceType {
            case .document:
                if let document = source.document {
                    for chunk in document.chunks {
                        allChunks.append((chunk, document.filename, .document))
                    }
                }

            case .webpage:
                if let webpage = source.webpage {
                    // Create a virtual chunk from webpage content
                    let chunk = DocumentChunk(
                        content: webpage.extractedContent,
                        chunkIndex: 0
                    )
                    allChunks.append((chunk, webpage.pageTitle, .webpage))
                }

            case .audioTranscription:
                if let audio = source.audioFile {
                    let chunk = DocumentChunk(
                        content: audio.transcription,
                        chunkIndex: 0
                    )
                    allChunks.append((chunk, audio.filename, .audioTranscription))
                }

            case .note:
                if let note = source.note {
                    let chunk = DocumentChunk(
                        content: note.content,
                        chunkIndex: 0
                    )
                    allChunks.append((chunk, note.title, .note))
                }
            }
        }

        return allChunks
    }

    /// Calculate cosine similarity between two vectors
    private func cosineSimilarity(_ a: [Float], _ b: [Float]) -> Float {
        guard a.count == b.count else { return 0.0 }

        let dotProduct = zip(a, b).map(*).reduce(0, +)
        let magnitudeA = sqrt(a.map { $0 * $0 }.reduce(0, +))
        let magnitudeB = sqrt(b.map { $0 * $0 }.reduce(0, +))

        guard magnitudeA > 0 && magnitudeB > 0 else { return 0.0 }

        return dotProduct / (magnitudeA * magnitudeB)
    }
}

// MARK: - Source-Grounded Chat Engine

@MainActor
class GroundedChatEngine: ObservableObject {
    private let modelOrchestrator: ModelOrchestrator
    private let retrievalEngine: RetrievalEngine

    init(modelOrchestrator: ModelOrchestrator, ollamaService: OllamaService) {
        self.modelOrchestrator = modelOrchestrator
        self.retrievalEngine = RetrievalEngine(ollamaService: ollamaService)
    }

    /// Send message with source-grounded context
    func sendMessage(
        _ content: String,
        in chatSession: ChatSession,
        project: Workspace?
    ) async throws -> (response: String, citations: [Citation]) {
        var relevantSources: [RetrievalResult] = []

        // Retrieve relevant source material if project has documents
        if let project = project, !project.sources.isEmpty {
            relevantSources = await retrievalEngine.findRelevantChunks(content, in: project)
        }

        // Build augmented prompt with source context
        let augmentedPrompt = buildAugmentedPrompt(
            userMessage: content,
            sources: relevantSources
        )

        // Generate response
        let response = try await modelOrchestrator.processMessage(
            augmentedPrompt,
            context: chatSession.getContextMessages(),
            model: chatSession.modelName
        )

        // Create citations
        let citations = relevantSources.map { result in
            Citation(
                sourceID: result.chunk.id.uuidString,
                sourceTitle: result.sourceTitle,
                sourceType: result.sourceType.rawValue,
                excerpt: String(result.chunk.content.prefix(200)),
                relevanceScore: result.relevanceScore,
                pageNumber: result.chunk.pageNumber
            )
        }

        return (response, citations)
    }

    /// Build prompt with source context
    private func buildAugmentedPrompt(
        userMessage: String,
        sources: [RetrievalResult]
    ) -> String {
        guard !sources.isEmpty else {
            return userMessage
        }

        var prompt = "You are a helpful AI assistant. Use the following source material to answer the user's question. Cite specific sources when relevant.\n\n"

        prompt += "## Source Material:\n\n"

        for (index, result) in sources.enumerated() {
            prompt += "### Source \(index + 1): \(result.sourceTitle)\n"
            prompt += result.chunk.content + "\n\n"
        }

        prompt += "## User Question:\n"
        prompt += userMessage + "\n\n"
        prompt += "## Instructions:\n"
        prompt += "- Answer based on the provided sources\n"
        prompt += "- Reference sources by number when citing information\n"
        prompt += "- If sources don't contain the answer, say so clearly\n"

        return prompt
    }
}

// MARK: - Supporting Types

struct RetrievalResult {
    let chunk: DocumentChunk
    let sourceTitle: String
    let sourceType: ProjectSourceType
    let relevanceScore: Double

    var preview: String {
        String(chunk.content.prefix(150)) + "..."
    }
}

// MARK: - Content Generator

@MainActor
class ContentGenerator: ObservableObject {
    private let modelOrchestrator: ModelOrchestrator

    init(modelOrchestrator: ModelOrchestrator) {
        self.modelOrchestrator = modelOrchestrator
    }

    /// Generate study guide from project sources
    func generateStudyGuide(from project: Workspace) async throws -> ProjectNote {
        let allContent = collectProjectContent(project)

        let prompt = """
        Create a comprehensive study guide based on the following materials:

        \(allContent)

        Structure the study guide with:
        1. Key Concepts
        2. Important Definitions
        3. Main Topics
        4. Practice Questions

        Make it clear and well-organized.
        """

        let studyGuide = try await modelOrchestrator.processMessage(prompt, context: [])

        return ProjectNote(
            title: "Study Guide: \(project.title)",
            content: studyGuide,
            noteType: .aiGenerated,
            tags: ["study-guide", "generated"]
        )
    }

    /// Extract key concepts and create learning goals
    func extractKeyConcepts(from project: Workspace) async throws -> [LearningGoal] {
        let allContent = collectProjectContent(project)

        let prompt = """
        Analyze the following materials and identify 3-5 key learning goals.
        For each goal, provide:
        - A clear title
        - A brief description
        - What mastering it would demonstrate

        Materials:
        \(allContent)

        Format each goal as:
        GOAL: [title]
        DESCRIPTION: [description]
        ---
        """

        let response = try await modelOrchestrator.processMessage(prompt, context: [])

        // Parse the response into learning goals
        return parseGoalsFromResponse(response)
    }

    /// Generate quiz based on project content
    func generateQuiz(from project: Workspace, questionCount: Int = 5) async throws -> ProjectNote {
        let allContent = collectProjectContent(project)

        let prompt = """
        Create a quiz with \(questionCount) questions based on these materials:

        \(allContent)

        For each question:
        1. Ask a clear, specific question
        2. Provide 4 multiple choice options (A, B, C, D)
        3. Indicate the correct answer
        4. Provide a brief explanation

        Make questions challenging but fair.
        """

        let quiz = try await modelOrchestrator.processMessage(prompt, context: [])

        return ProjectNote(
            title: "Quiz: \(project.title)",
            content: quiz,
            noteType: .quiz,
            tags: ["quiz", "generated", "assessment"]
        )
    }

    // MARK: - Helper Methods

    private func collectProjectContent(_ project: Workspace) -> String {
        var content = ""

        for source in project.sources {
            switch source.type {
            case .document:
                if let doc = source.document {
                    content += "## Document: \(doc.filename)\n"
                    content += doc.extractedText + "\n\n"
                }
            case .webpage:
                if let web = source.webpage {
                    content += "## Webpage: \(web.pageTitle)\n"
                    content += web.extractedContent + "\n\n"
                }
            case .audioTranscription:
                if let audio = source.audioFile {
                    content += "## Audio: \(audio.filename)\n"
                    content += audio.transcription + "\n\n"
                }
            case .note:
                if let note = source.note {
                    content += "## Note: \(note.title)\n"
                    content += note.content + "\n\n"
                }
            }
        }

        // Limit content length to avoid context overflow
        if content.count > 50000 {
            content = String(content.prefix(50000)) + "\n...[truncated for length]..."
        }

        return content
    }

    private func parseGoalsFromResponse(_ response: String) -> [LearningGoal] {
        let sections = response.components(separatedBy: "---")
        var goals: [LearningGoal] = []

        for section in sections {
            let lines = section.split(separator: "\n")
            var title = ""
            var description = ""

            for line in lines {
                let lineStr = String(line).trimmingCharacters(in: .whitespaces)
                if lineStr.hasPrefix("GOAL:") {
                    title = lineStr.replacingOccurrences(of: "GOAL:", with: "").trimmingCharacters(in: .whitespaces)
                } else if lineStr.hasPrefix("DESCRIPTION:") {
                    description = lineStr.replacingOccurrences(of: "DESCRIPTION:", with: "").trimmingCharacters(in: .whitespaces)
                }
            }

            if !title.isEmpty && !description.isEmpty {
                goals.append(LearningGoal(
                    title: title,
                    description: description,
                    progress: 0.0
                ))
            }
        }

        return goals
    }
}
