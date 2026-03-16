import Foundation
import SwiftData

// MARK: - Concept Extraction Service

@MainActor
class ConceptExtractor: ObservableObject {
    @Published var isExtracting = false
    @Published var extractionProgress: Double = 0.0

    private let modelOrchestrator: ModelOrchestrator
    private let linkingEngine: LinkingEngine

    init(modelOrchestrator: ModelOrchestrator, linkingEngine: LinkingEngine) {
        self.modelOrchestrator = modelOrchestrator
        self.linkingEngine = linkingEngine
    }

    // MARK: - Extract from Chat

    /// Extract concepts from a chat session
    func extractFromChat(_ chatSession: ChatSession) async throws -> [ConceptNode] {
        isExtracting = true
        extractionProgress = 0.0

        defer {
            isExtracting = false
            extractionProgress = 1.0
        }

        // Combine all messages
        let conversation = chatSession.messages
            .sorted { $0.timestamp < $1.timestamp }
            .map { "\($0.role.rawValue): \($0.content)" }
            .joined(separator: "\n\n")

        extractionProgress = 0.3

        // Ask AI to extract concepts
        let prompt = """
        Analyze the following conversation and extract key concepts, topics, and important terms.

        For each concept, provide:
        1. Name (concise, 2-4 words)
        2. Type (topic/technology/definition/insight/question)
        3. Brief description (one sentence)
        4. Related concepts (if any)

        Conversation:
        \(conversation)

        Format each concept as:
        CONCEPT: [name]
        TYPE: [type]
        DESCRIPTION: [description]
        RELATED: [concept1, concept2, ...]
        ---
        """

        let response = try await modelOrchestrator.processMessage(prompt, context: [])

        extractionProgress = 0.7

        // Parse response
        let concepts = parseConceptsFromResponse(
            response,
            project: chatSession.project
        )

        extractionProgress = 1.0

        return concepts
    }

    // MARK: - Extract from Document

    /// Extract concepts from a document
    func extractFromDocument(_ document: UploadedDocument) async throws -> [ConceptNode] {
        isExtracting = true
        extractionProgress = 0.0

        defer {
            isExtracting = false
            extractionProgress = 1.0
        }

        // Use first 5000 characters for extraction
        let sampleText = String(document.extractedText.prefix(5000))

        extractionProgress = 0.3

        let prompt = """
        Analyze this document excerpt and extract key concepts, topics, and important terms.

        Document: \(document.filename)

        For each concept, provide:
        1. Name (concise, 2-4 words)
        2. Type (topic/technology/definition/person/resource)
        3. Brief description
        4. Related concepts

        Text:
        \(sampleText)

        Format each concept as:
        CONCEPT: [name]
        TYPE: [type]
        DESCRIPTION: [description]
        RELATED: [concept1, concept2, ...]
        ---
        """

        let response = try await modelOrchestrator.processMessage(prompt, context: [])

        extractionProgress = 0.7

        let concepts = parseConceptsFromResponse(
            response,
            project: document.source?.project
        )

        extractionProgress = 1.0

        return concepts
    }

    // MARK: - Extract from Project

    /// Extract concepts from entire project (all chats + documents)
    func extractFromProject(_ project: AetheriumProject) async throws -> [ConceptNode] {
        isExtracting = true
        extractionProgress = 0.0

        var allConcepts: [ConceptNode] = []

        // Extract from chats
        let totalItems = project.chatSessions.count + project.sources.count
        var processedItems = 0

        for chat in project.chatSessions {
            let concepts = try await extractFromChat(chat)
            allConcepts.append(contentsOf: concepts)

            processedItems += 1
            extractionProgress = Double(processedItems) / Double(totalItems)
        }

        // Extract from documents
        for source in project.sources {
            if let document = source.document {
                let concepts = try await extractFromDocument(document)
                allConcepts.append(contentsOf: concepts)
            }

            processedItems += 1
            extractionProgress = Double(processedItems) / Double(totalItems)
        }

        isExtracting = false
        extractionProgress = 1.0

        // Deduplicate and merge similar concepts
        return deduplicateConcepts(allConcepts)
    }

    // MARK: - Automatic Linking

    /// Automatically create links between related concepts
    func autoLinkConcepts(_ concepts: [ConceptNode]) async {
        for i in 0..<concepts.count {
            for j in (i+1)..<concepts.count {
                let concept1 = concepts[i]
                let concept2 = concepts[j]

                // Check if they should be linked
                if shouldLink(concept1, to: concept2) {
                    linkingEngine.linkConcepts(
                        concept1,
                        to: concept2,
                        type: .related,
                        strength: calculateLinkStrength(concept1, concept2)
                    )
                }
            }
        }
    }

    // MARK: - Helpers

    private func parseConceptsFromResponse(
        _ response: String,
        project: AetheriumProject?
    ) -> [ConceptNode] {
        let sections = response.components(separatedBy: "---")
        var concepts: [ConceptNode] = []

        for section in sections {
            guard !section.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                continue
            }

            var name = ""
            var type = ConceptNodeType.topic
            var description = ""
            var relatedNames: [String] = []

            let lines = section.components(separatedBy: "\n")

            for line in lines {
                let trimmed = line.trimmingCharacters(in: .whitespaces)

                if trimmed.hasPrefix("CONCEPT:") {
                    name = trimmed.replacingOccurrences(of: "CONCEPT:", with: "")
                        .trimmingCharacters(in: .whitespaces)
                } else if trimmed.hasPrefix("TYPE:") {
                    let typeStr = trimmed.replacingOccurrences(of: "TYPE:", with: "")
                        .trimmingCharacters(in: .whitespaces)
                        .lowercased()
                    type = ConceptNodeType(rawValue: typeStr) ?? .topic
                } else if trimmed.hasPrefix("DESCRIPTION:") {
                    description = trimmed.replacingOccurrences(of: "DESCRIPTION:", with: "")
                        .trimmingCharacters(in: .whitespaces)
                } else if trimmed.hasPrefix("RELATED:") {
                    let relatedStr = trimmed.replacingOccurrences(of: "RELATED:", with: "")
                        .trimmingCharacters(in: .whitespaces)
                    relatedNames = relatedStr.components(separatedBy: ",").map {
                        $0.trimmingCharacters(in: .whitespaces)
                    }
                }
            }

            if !name.isEmpty {
                let concept = ConceptNode(
                    name: name,
                    description: description.isEmpty ? nil : description,
                    nodeType: type
                )
                concept.project = project
                concepts.append(concept)

                // Store related names for later linking
                concept.aliases = relatedNames
            }
        }

        return concepts
    }

    private func deduplicateConcepts(_ concepts: [ConceptNode]) -> [ConceptNode] {
        var seen = Set<String>()
        var unique: [ConceptNode] = []

        for concept in concepts {
            let normalizedName = concept.name.lowercased()
            if !seen.contains(normalizedName) {
                seen.insert(normalizedName)
                unique.append(concept)
            } else {
                // Merge with existing
                if let existing = unique.first(where: {
                    $0.name.lowercased() == normalizedName
                }) {
                    // Combine descriptions
                    if let newDesc = concept.conceptDescription,
                       let existingDesc = existing.conceptDescription,
                       !existingDesc.contains(newDesc) {
                        existing.conceptDescription = existingDesc + " " + newDesc
                    }

                    // Merge aliases
                    existing.aliases.append(contentsOf: concept.aliases)

                    // Increment reference count
                    existing.incrementReference()
                }
            }
        }

        return unique
    }

    private func shouldLink(_ concept1: ConceptNode, to concept2: ConceptNode) -> Bool {
        // Link if one mentions the other in description
        if let desc1 = concept1.conceptDescription?.lowercased(),
           desc1.contains(concept2.name.lowercased()) {
            return true
        }

        if let desc2 = concept2.conceptDescription?.lowercased(),
           desc2.contains(concept1.name.lowercased()) {
            return true
        }

        // Link if they share tags
        if !Set(concept1.tags).isDisjoint(with: Set(concept2.tags)) {
            return true
        }

        // Link if in each other's related concepts (from aliases)
        if concept1.aliases.contains(where: { alias in
            concept2.name.lowercased().contains(alias.lowercased())
        }) {
            return true
        }

        return false
    }

    private func calculateLinkStrength(_ concept1: ConceptNode, _ concept2: ConceptNode) -> Double {
        var strength = 0.5

        // Increase if mentioned in description
        if let desc1 = concept1.conceptDescription,
           desc1.lowercased().contains(concept2.name.lowercased()) {
            strength += 0.2
        }

        // Increase if share tags
        let sharedTags = Set(concept1.tags).intersection(Set(concept2.tags)).count
        strength += Double(sharedTags) * 0.1

        return min(strength, 1.0)
    }
}

// MARK: - Batch Extraction

extension ConceptExtractor {
    /// Extract concepts from multiple sources concurrently
    func batchExtract(
        chats: [ChatSession],
        documents: [UploadedDocument]
    ) async throws -> [ConceptNode] {
        var allConcepts: [ConceptNode] = []

        // Process in batches of 3 to avoid overwhelming the model
        let chatBatches = chats.conceptChunked(into: 3)

        for batch in chatBatches {
            for chat in batch {
                let concepts = try await self.extractFromChat(chat)
                allConcepts.append(contentsOf: concepts)
            }
        }

        return deduplicateConcepts(allConcepts)
    }
}

// MARK: - Array Extension

private extension Array {
    func conceptChunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}
