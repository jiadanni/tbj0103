import Foundation
import SwiftData

// MARK: - Bidirectional Linking Engine

@MainActor
class LinkingEngine: ObservableObject {
    @Published var suggestions: [ConceptNode] = []

    private let modelContext: ModelContext

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
    }

    // MARK: - Link Parsing

    /// Parse [[concept]] syntax from text
    func parseLinks(from text: String) -> [ParsedLink] {
        let pattern = #"\[\[([^\]]+)\]\]"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            return []
        }

        let range = NSRange(text.startIndex..., in: text)
        let matches = regex.matches(in: text, range: range)

        return matches.compactMap { match -> ParsedLink? in
            guard match.numberOfRanges >= 2,
                  let conceptRange = Range(match.range(at: 1), in: text) else {
                return nil
            }

            let conceptName = String(text[conceptRange])
            let fullRange = Range(match.range(at: 0), in: text)!

            // Extract context (50 chars before and after)
            let contextStart = text.index(
                fullRange.lowerBound,
                offsetBy: -50,
                limitedBy: text.startIndex
            ) ?? text.startIndex

            let contextEnd = text.index(
                fullRange.upperBound,
                offsetBy: 50,
                limitedBy: text.endIndex
            ) ?? text.endIndex

            let context = String(text[contextStart..<contextEnd])

            return ParsedLink(
                conceptName: conceptName,
                range: fullRange,
                context: context
            )
        }
    }

    /// Create or retrieve concepts from parsed links
    func processParsedLinks(
        _ parsedLinks: [ParsedLink],
        in project: AetheriumProject
    ) async -> [ConceptNode] {
        var concepts: [ConceptNode] = []

        for link in parsedLinks {
            let concept = await getOrCreateConcept(
                name: link.conceptName,
                in: project
            )
            concepts.append(concept)
        }

        return concepts
    }

    /// Process all [[concept]] links in text and create/update concepts
    func processConceptLinks(
        in text: String,
        project: AetheriumProject,
        sourceType: MentionSourceType = .note,
        sourceID: String? = nil
    ) async {
        // Parse all links from text
        let parsedLinks = parseLinks(from: text)

        guard !parsedLinks.isEmpty else { return }

        // Process each link
        for link in parsedLinks {
            let concept = await getOrCreateConcept(
                name: link.conceptName,
                in: project
            )

            // Record mention if sourceID provided
            if let sourceID = sourceID {
                recordMention(
                    concept: concept,
                    in: sourceType,
                    sourceID: sourceID,
                    context: link.context,
                    position: 0
                )
            }
        }
    }

    // MARK: - Concept Management

    /// Get existing concept or create new one
    func getOrCreateConcept(
        name: String,
        in project: AetheriumProject
    ) async -> ConceptNode {
        // Normalize name
        let normalizedName = name.trimmingCharacters(in: .whitespaces)

        // Search for existing concept
        let descriptor = FetchDescriptor<ConceptNode>(
            predicate: #Predicate { concept in
                concept.name.localizedStandardContains(normalizedName)
            }
        )

        if let existing = try? modelContext.fetch(descriptor).first {
            existing.incrementReference()
            return existing
        }

        // Create new concept
        let newConcept = ConceptNode(name: normalizedName)
        newConcept.project = project
        modelContext.insert(newConcept)

        return newConcept
    }

    /// Link two concepts together
    func linkConcepts(
        _ source: ConceptNode,
        to target: ConceptNode,
        type: ConceptLinkType = .related,
        strength: Double = 1.0,
        context: String? = nil
    ) {
        // Check if link already exists
        let existingLink = source.outgoingLinks.first { link in
            link.target?.id == target.id
        }

        if let existing = existingLink {
            // Update strength (average with new strength)
            existing.strength = (existing.strength + strength) / 2.0
        } else {
            // Create new link
            let link = ConceptLink(
                source: source,
                target: target,
                linkType: type,
                strength: strength,
                context: context
            )
            modelContext.insert(link)
        }
    }

    // MARK: - Mention Tracking

    /// Record where a concept was mentioned
    func recordMention(
        concept: ConceptNode,
        in sourceType: MentionSourceType,
        sourceID: String,
        context: String,
        position: Int
    ) {
        let mention = ConceptMention(
            mentionContext: context,
            position: position,
            sourceType: sourceType,
            sourceID: sourceID
        )
        mention.concept = concept
        modelContext.insert(mention)

        concept.incrementReference()
    }

    // MARK: - Auto-Suggestion

    /// Find concepts matching partial text
    func suggestConcepts(
        matching text: String,
        in project: AetheriumProject,
        limit: Int = 5
    ) async -> [ConceptNode] {
        guard !text.isEmpty else { return [] }

        let descriptor = FetchDescriptor<ConceptNode>(
            predicate: #Predicate { concept in
                concept.name.localizedStandardContains(text) ||
                concept.aliases.contains(text)
            },
            sortBy: [SortDescriptor(\.referenceCount, order: .reverse)]
        )

        do {
            let results = try modelContext.fetch(descriptor)
            return Array(results.prefix(limit))
        } catch {
            return []
        }
    }

    // MARK: - Backlinks

    /// Get all content that links to a concept
    func getBacklinks(for concept: ConceptNode) -> [Backlink] {
        var backlinks: [Backlink] = []

        // From mentions
        for mention in concept.mentions {
            let backlink = Backlink(
                sourceType: MentionSourceType(rawValue: mention.sourceType) ?? .note,
                sourceID: mention.sourceID,
                context: mention.mentionContext,
                createdAt: mention.createdAt
            )
            backlinks.append(backlink)
        }

        // From incoming concept links
        for link in concept.incomingLinks {
            if let source = link.source {
                let backlink = Backlink(
                    sourceType: .note,
                    sourceID: source.id.uuidString,
                    context: link.context ?? source.name,
                    createdAt: link.createdAt
                )
                backlinks.append(backlink)
            }
        }

        return backlinks.sorted { $0.createdAt > $1.createdAt }
    }

    // MARK: - Automatic Link Detection

    /// Detect potential concepts in text (without [[]] syntax)
    func detectPotentialConcepts(
        in text: String,
        project: AetheriumProject
    ) async -> [DetectedConcept] {
        // Get all concepts in project
        let descriptor = FetchDescriptor<ConceptNode>(
            predicate: #Predicate { concept in
                concept.project?.id == project.id
            }
        )

        guard let allConcepts = try? modelContext.fetch(descriptor) else {
            return []
        }

        var detected: [DetectedConcept] = []
        let lowercasedText = text.lowercased()

        for concept in allConcepts {
            // Check for concept name
            if let range = lowercasedText.range(of: concept.name.lowercased()) {
                detected.append(DetectedConcept(
                    concept: concept,
                    range: range,
                    confidence: 1.0
                ))
            }

            // Check for aliases
            for alias in concept.aliases {
                if let range = lowercasedText.range(of: alias.lowercased()) {
                    detected.append(DetectedConcept(
                        concept: concept,
                        range: range,
                        confidence: 0.9
                    ))
                }
            }
        }

        return detected
    }
}

// MARK: - Supporting Types

struct ParsedLink {
    let conceptName: String
    let range: Range<String.Index>
    let context: String
}

struct Backlink: Identifiable {
    let id = UUID()
    let sourceType: MentionSourceType
    let sourceID: String
    let context: String
    let createdAt: Date

    var displayTitle: String {
        switch sourceType {
        case .message: return "Chat Message"
        case .note: return "Note"
        case .documentChunk: return "Document"
        case .learningGoal: return "Learning Goal"
        }
    }
}

struct DetectedConcept {
    let concept: ConceptNode
    let range: Range<String.Index>
    let confidence: Double
}

// MARK: - Text Processing Helpers

extension LinkingEngine {
    /// Replace [[concept]] links with clickable versions
    func renderLinks(in text: String) -> AttributedString {
        var attributedText = AttributedString(text)
        let parsedLinks = parseLinks(from: text)

        for link in parsedLinks.reversed() {
            let nsRange = NSRange(link.range, in: text)
            if let range = Range<AttributedString.Index>(nsRange, in: attributedText) {
                attributedText[range].foregroundColor = .blue
                attributedText[range].underlineStyle = .single
                attributedText[range].link = URL(string: "aetherium://concept/\(link.conceptName)")
            }
        }

        return attributedText
    }

    /// Convert plain text to linked text (auto-detect concepts)
    func autoLink(text: String, project: AetheriumProject) async -> String {
        let detected = await detectPotentialConcepts(in: text, project: project)

        var linkedText = text
        var offset = 0

        for detection in detected.sorted(by: { $0.range.lowerBound < $1.range.lowerBound }) {
            let adjustedRange = Range(
                uncheckedBounds: (
                    lower: text.index(detection.range.lowerBound, offsetBy: offset),
                    upper: text.index(detection.range.upperBound, offsetBy: offset)
                )
            )

            let conceptName = detection.concept.name
            let linkedVersion = "[[\(conceptName)]]"

            linkedText.replaceSubrange(adjustedRange, with: linkedVersion)

            offset += linkedVersion.count - conceptName.count
        }

        return linkedText
    }
}
