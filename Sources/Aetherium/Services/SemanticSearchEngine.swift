import Foundation
import SwiftData

// MARK: - Semantic Search Engine

@MainActor
class SemanticSearchEngine: ObservableObject {
    @Published var results: [SearchResult] = []
    @Published var isSearching = false
    @Published var searchProgress: Double = 0.0

    private let ollamaService: OllamaService
    private let modelContext: ModelContext

    init(ollamaService: OllamaService, modelContext: ModelContext) {
        self.ollamaService = ollamaService
        self.modelContext = modelContext
    }

    // MARK: - Global Search

    func search(_ query: String, in project: AetheriumProject? = nil) async throws {
        guard !query.isEmpty else {
            results = []
            return
        }

        isSearching = true
        searchProgress = 0.0
        defer {
            isSearching = false
            searchProgress = 1.0
        }

        // Generate query embedding
        let queryEmbedding = try await ollamaService.generateEmbedding(query)
        searchProgress = 0.2

        var allResults: [SearchResult] = []

        // Search document chunks
        let documentResults = await searchDocuments(queryEmbedding, in: project)
        allResults.append(contentsOf: documentResults)
        searchProgress = 0.4

        // Search chat messages
        let chatResults = await searchChats(queryEmbedding, query: query, in: project)
        allResults.append(contentsOf: chatResults)
        searchProgress = 0.6

        // Search concepts
        let conceptResults = await searchConcepts(queryEmbedding, query: query, in: project)
        allResults.append(contentsOf: conceptResults)
        searchProgress = 0.8

        // Search notes
        let noteResults = await searchNotes(queryEmbedding, query: query, in: project)
        allResults.append(contentsOf: noteResults)
        searchProgress = 1.0

        // Sort by similarity and recency
        results = allResults
            .sorted { lhs, rhs in
                // Primary: similarity
                if abs(lhs.similarity - rhs.similarity) > 0.1 {
                    return lhs.similarity > rhs.similarity
                }
                // Secondary: recency
                return (lhs.timestamp ?? Date.distantPast) > (rhs.timestamp ?? Date.distantPast)
            }
    }

    // MARK: - Search by Content Type

    private func searchDocuments(_ embedding: [Float], in project: AetheriumProject?) async -> [SearchResult] {
        var results: [SearchResult] = []

        let descriptor: FetchDescriptor<UploadedDocument>
        if let project = project {
            let projectId = project.id
            descriptor = FetchDescriptor<UploadedDocument>(
                predicate: #Predicate { doc in
                    doc.source?.project?.id == projectId
                }
            )
        } else {
            descriptor = FetchDescriptor<UploadedDocument>()
        }

        guard let documents = try? modelContext.fetch(descriptor) else {
            return results
        }

        for doc in documents {
            for chunk in doc.chunks {
                guard let chunkEmbedding = chunk.embeddings else { continue }

                let similarity = cosineSimilarity(embedding, chunkEmbedding)
                if similarity > 0.7 {
                    results.append(SearchResult(
                        type: .documentChunk,
                        title: doc.filename,
                        excerpt: String(chunk.content.prefix(200)),
                        similarity: similarity,
                        sourceID: chunk.id.uuidString,
                        timestamp: doc.processedAt,
                        metadata: SearchMetadata(
                            documentID: doc.id.uuidString,
                            pageNumber: chunk.pageNumber,
                            chunkIndex: chunk.chunkIndex
                        )
                    ))
                }
            }
        }

        return results
    }

    private func searchChats(_ embedding: [Float], query: String, in project: AetheriumProject?) async -> [SearchResult] {
        var results: [SearchResult] = []

        let descriptor: FetchDescriptor<ChatSession>
        if let project = project {
            let projectId = project.id
            descriptor = FetchDescriptor<ChatSession>(
                predicate: #Predicate { chat in
                    chat.project?.id == projectId
                }
            )
        } else {
            descriptor = FetchDescriptor<ChatSession>()
        }

        guard let chats = try? modelContext.fetch(descriptor) else {
            return results
        }

        for chat in chats {
            for message in chat.messages {
                // Generate embedding for message (with caching)
                guard let messageEmbedding = try? await ollamaService.generateEmbedding(message.content) else {
                    continue
                }

                let similarity = cosineSimilarity(embedding, messageEmbedding)
                if similarity > 0.7 {
                    results.append(SearchResult(
                        type: .chatMessage,
                        title: "Chat: \(chat.title)",
                        excerpt: String(message.content.prefix(200)),
                        similarity: similarity,
                        sourceID: message.id.uuidString,
                        timestamp: message.timestamp,
                        metadata: SearchMetadata(
                            chatID: chat.id.uuidString,
                            messageRole: message.role.rawValue
                        )
                    ))
                }
            }
        }

        return results
    }

    private func searchConcepts(_ embedding: [Float], query: String, in project: AetheriumProject?) async -> [SearchResult] {
        var results: [SearchResult] = []

        let descriptor: FetchDescriptor<ConceptNode>
        if let project = project {
            let projectId = project.id
            descriptor = FetchDescriptor<ConceptNode>(
                predicate: #Predicate { concept in
                    concept.project?.id == projectId
                }
            )
        } else {
            descriptor = FetchDescriptor<ConceptNode>()
        }

        guard let concepts = try? modelContext.fetch(descriptor) else {
            return results
        }

        for concept in concepts {
            // Check name match first (fast path)
            if concept.name.localizedCaseInsensitiveContains(query) {
                results.append(SearchResult(
                    type: .concept,
                    title: concept.name,
                    excerpt: concept.conceptDescription ?? "",
                    similarity: 1.0, // Exact match
                    sourceID: concept.id.uuidString,
                    timestamp: concept.lastReferencedAt,
                    metadata: SearchMetadata(
                        conceptType: concept.type.rawValue,
                        referenceCount: concept.referenceCount
                    )
                ))
                continue
            }

            // Semantic search in description
            if let description = concept.conceptDescription {
                guard let conceptEmbedding = try? await ollamaService.generateEmbedding(description) else {
                    continue
                }

                let similarity = cosineSimilarity(embedding, conceptEmbedding)
                if similarity > 0.7 {
                    results.append(SearchResult(
                        type: .concept,
                        title: concept.name,
                        excerpt: description,
                        similarity: similarity,
                        sourceID: concept.id.uuidString,
                        timestamp: concept.lastReferencedAt,
                        metadata: SearchMetadata(
                            conceptType: concept.type.rawValue,
                            referenceCount: concept.referenceCount
                        )
                    ))
                }
            }
        }

        return results
    }

    private func searchNotes(_ embedding: [Float], query: String, in project: AetheriumProject?) async -> [SearchResult] {
        var results: [SearchResult] = []

        let descriptor: FetchDescriptor<ProjectNote>
        if let project = project {
            let projectId = project.id
            descriptor = FetchDescriptor<ProjectNote>(
                predicate: #Predicate { note in
                    note.source?.project?.id == projectId
                }
            )
        } else {
            descriptor = FetchDescriptor<ProjectNote>()
        }

        guard let notes = try? modelContext.fetch(descriptor) else {
            return results
        }

        for note in notes {
            // Search in title and content
            let combinedText = "\(note.title) \(note.content)"

            guard let noteEmbedding = try? await ollamaService.generateEmbedding(combinedText) else {
                continue
            }

            let similarity = cosineSimilarity(embedding, noteEmbedding)
            if similarity > 0.7 {
                results.append(SearchResult(
                    type: .note,
                    title: note.title,
                    excerpt: String(note.content.prefix(200)),
                    similarity: similarity,
                    sourceID: note.id.uuidString,
                    timestamp: note.updatedAt,
                    metadata: SearchMetadata(
                        noteType: note.noteType
                    )
                ))
            }
        }

        return results
    }

    // MARK: - Similarity Calculation

    private func cosineSimilarity(_ a: [Float], _ b: [Float]) -> Double {
        guard a.count == b.count else { return 0.0 }

        let dotProduct = zip(a, b).map(*).reduce(0, +)
        let magnitudeA = sqrt(a.map { $0 * $0 }.reduce(0, +))
        let magnitudeB = sqrt(b.map { $0 * $0 }.reduce(0, +))

        guard magnitudeA > 0 && magnitudeB > 0 else { return 0.0 }

        return Double(dotProduct / (magnitudeA * magnitudeB))
    }
}

// MARK: - Search Result Types

struct SearchResult: Identifiable {
    let id = UUID()
    let type: ResultType
    let title: String
    let excerpt: String
    let similarity: Double
    let sourceID: String
    let timestamp: Date?
    let metadata: SearchMetadata

    enum ResultType {
        case documentChunk
        case chatMessage
        case concept
        case note
        case learningGoal
    }

    var iconName: String {
        switch type {
        case .documentChunk: return "doc.text"
        case .chatMessage: return "message"
        case .concept: return "brain"
        case .note: return "note.text"
        case .learningGoal: return "target"
        }
    }

    var typeDescription: String {
        switch type {
        case .documentChunk: return "Document"
        case .chatMessage: return "Chat"
        case .concept: return "Concept"
        case .note: return "Note"
        case .learningGoal: return "Goal"
        }
    }
}

struct SearchMetadata {
    var documentID: String?
    var pageNumber: Int?
    var chunkIndex: Int?
    var chatID: String?
    var messageRole: String?
    var conceptType: String?
    var referenceCount: Int?
    var noteType: String?

    init(
        documentID: String? = nil,
        pageNumber: Int? = nil,
        chunkIndex: Int? = nil,
        chatID: String? = nil,
        messageRole: String? = nil,
        conceptType: String? = nil,
        referenceCount: Int? = nil,
        noteType: String? = nil
    ) {
        self.documentID = documentID
        self.pageNumber = pageNumber
        self.chunkIndex = chunkIndex
        self.chatID = chatID
        self.messageRole = messageRole
        self.conceptType = conceptType
        self.referenceCount = referenceCount
        self.noteType = noteType
    }
}
