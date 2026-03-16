import Foundation
import SwiftData

// MARK: - Knowledge Graph Models

@Model
final class ConceptNode {
    @Attribute(.unique) var id: UUID
    var name: String
    var conceptDescription: String?
    var createdAt: Date
    var lastReferencedAt: Date
    var referenceCount: Int
    var nodeType: String // ConceptNodeType.rawValue
    var aliases: [String] // Alternative names

    // Relationships
    @Relationship(deleteRule: .cascade) var outgoingLinks: [ConceptLink]
    @Relationship(deleteRule: .nullify) var incomingLinks: [ConceptLink]
    @Relationship(deleteRule: .nullify) var mentions: [ConceptMention]
    var project: AetheriumProject?

    // Metadata
    var tags: [String]
    var relatedGoalIDs: [String]

    init(
        id: UUID = UUID(),
        name: String,
        description: String? = nil,
        nodeType: ConceptNodeType = .topic,
        aliases: [String] = [],
        tags: [String] = []
    ) {
        self.id = id
        self.name = name
        self.conceptDescription = description
        self.createdAt = Date()
        self.lastReferencedAt = Date()
        self.referenceCount = 0
        self.nodeType = nodeType.rawValue
        self.aliases = aliases
        self.tags = tags
        self.outgoingLinks = []
        self.incomingLinks = []
        self.mentions = []
        self.relatedGoalIDs = []
    }

    var type: ConceptNodeType {
        ConceptNodeType(rawValue: nodeType) ?? .topic
    }

    func incrementReference() {
        referenceCount += 1
        lastReferencedAt = Date()
    }

    /// Get all nodes this concept links to
    var linkedConcepts: [ConceptNode] {
        outgoingLinks.compactMap { $0.target }
    }

    /// Get all nodes that link to this concept (backlinks)
    var backlinkedConcepts: [ConceptNode] {
        incomingLinks.compactMap { $0.source }
    }
}

@Model
final class ConceptLink {
    @Attribute(.unique) var id: UUID
    var linkType: String // ConceptLinkType.rawValue
    var strength: Double // 0.0 to 1.0
    var createdAt: Date
    var context: String? // Surrounding text where link was created

    var source: ConceptNode?
    var target: ConceptNode?

    init(
        id: UUID = UUID(),
        source: ConceptNode,
        target: ConceptNode,
        linkType: ConceptLinkType = .related,
        strength: Double = 1.0,
        context: String? = nil
    ) {
        self.id = id
        self.linkType = linkType.rawValue
        self.strength = strength
        self.createdAt = Date()
        self.context = context
        self.source = source
        self.target = target
    }

    var type: ConceptLinkType {
        ConceptLinkType(rawValue: linkType) ?? .related
    }
}

@Model
final class ConceptMention {
    @Attribute(.unique) var id: UUID
    var mentionContext: String // Surrounding text
    var position: Int // Character offset in content
    var createdAt: Date

    // Where was this concept mentioned?
    var sourceType: String // message, note, document_chunk
    var sourceID: String // UUID of the source

    var concept: ConceptNode?

    init(
        id: UUID = UUID(),
        mentionContext: String,
        position: Int,
        sourceType: MentionSourceType,
        sourceID: String
    ) {
        self.id = id
        self.mentionContext = mentionContext
        self.position = position
        self.createdAt = Date()
        self.sourceType = sourceType.rawValue
        self.sourceID = sourceID
    }
}

// MARK: - Supporting Types

enum ConceptNodeType: String, Codable, CaseIterable {
    case topic          // General concept
    case person         // People mentioned
    case technology     // Programming languages, frameworks
    case definition     // Technical definitions
    case question       // Unresolved questions
    case insight        // Key realizations
    case resource       // External resources
    case custom         // User-defined
}

enum ConceptLinkType: String, Codable, CaseIterable {
    case related        // General relationship
    case prerequisite   // A requires B
    case partOf         // A is part of B
    case similarTo      // A is similar to B
    case contradicts    // A contradicts B
    case exemplifies    // A is an example of B
    case custom         // User-defined
}

enum MentionSourceType: String, Codable {
    case message
    case note
    case documentChunk
    case learningGoal
}

// MARK: - Graph Statistics

struct GraphStatistics {
    let totalNodes: Int
    let totalLinks: Int
    let averageConnections: Double
    let mostConnectedConcepts: [(ConceptNode, Int)]
    let recentlyActiveConcepts: [ConceptNode]
    let orphanedConcepts: [ConceptNode]

    // Advanced Metrics
    let pageRankScores: [UUID: Double]
    let communities: [UUID: String]
    let centralityScores: [UUID: Int]
    let degreeDistribution: [Int: Int]
    let evolution: [(Date, Int, Int)]

    static func compute(from nodes: [ConceptNode]) -> GraphStatistics {
        let totalNodes = nodes.count
        let totalLinks = nodes.reduce(0) { $0 + $1.outgoingLinks.count }

        let averageConnections = totalNodes > 0
            ? Double(totalLinks) / Double(totalNodes)
            : 0.0

        // Most connected (by reference count)
        let mostConnected = nodes
            .sorted { $0.referenceCount > $1.referenceCount }
            .prefix(5)
            .map { ($0, $0.referenceCount) }

        // Recently active (by last referenced)
        let recentlyActive = nodes
            .sorted { $0.lastReferencedAt > $1.lastReferencedAt }
            .prefix(10)

        // Orphaned (no connections)
        let orphaned = nodes.filter {
            $0.outgoingLinks.isEmpty && $0.incomingLinks.isEmpty
        }

        // Advanced Metrics Compute
        let pageRankScores = GraphAlgorithms.computePageRank(nodes: nodes)
        let communities = GraphAlgorithms.detectCommunities(nodes: nodes)
        let centralityScores = GraphAlgorithms.computeCentrality(nodes: nodes)
        let degreeDistribution = GraphAlgorithms.computeDegreeDistribution(nodes: nodes)
        let evolution = GraphAlgorithms.computeEvolution(nodes: nodes)

        return GraphStatistics(
            totalNodes: totalNodes,
            totalLinks: totalLinks,
            averageConnections: averageConnections,
            mostConnectedConcepts: Array(mostConnected),
            recentlyActiveConcepts: Array(recentlyActive),
            orphanedConcepts: orphaned,
            pageRankScores: pageRankScores,
            communities: communities,
            centralityScores: centralityScores,
            degreeDistribution: degreeDistribution,
            evolution: evolution
        )
    }
}

// MARK: - Graph Query Helpers

extension ConceptNode {
    /// Find all concepts within N hops
    func conceptsWithinHops(_ maxHops: Int) -> Set<ConceptNode> {
        var visited = Set<UUID>()
        var result = Set<ConceptNode>()
        var currentLevel = [self]

        for _ in 0..<maxHops {
            var nextLevel: [ConceptNode] = []

            for node in currentLevel {
                if visited.contains(node.id) { continue }
                visited.insert(node.id)
                result.insert(node)

                // Add neighbors
                nextLevel.append(contentsOf: node.linkedConcepts)
                nextLevel.append(contentsOf: node.backlinkedConcepts)
            }

            currentLevel = nextLevel
            if currentLevel.isEmpty { break }
        }

        return result
    }

    /// Find shortest path to another concept
    func pathTo(_ target: ConceptNode) -> [ConceptNode]? {
        var visited = Set<UUID>()
        var queue: [(node: ConceptNode, path: [ConceptNode])] = [(self, [self])]

        while !queue.isEmpty {
            let (current, path) = queue.removeFirst()

            if current.id == target.id {
                return path
            }

            if visited.contains(current.id) { continue }
            visited.insert(current.id)

            for neighbor in current.linkedConcepts + current.backlinkedConcepts {
                if !visited.contains(neighbor.id) {
                    queue.append((neighbor, path + [neighbor]))
                }
            }
        }

        return nil
    }

    /// Get related concepts by tag overlap
    func relatedByTags(in allNodes: [ConceptNode]) -> [ConceptNode] {
        guard !tags.isEmpty else { return [] }

        return allNodes.filter { node in
            node.id != self.id && !Set(node.tags).isDisjoint(with: Set(tags))
        }.sorted { lhs, rhs in
            let lhsOverlap = Set(lhs.tags).intersection(Set(tags)).count
            let rhsOverlap = Set(rhs.tags).intersection(Set(tags)).count
            return lhsOverlap > rhsOverlap
        }
    }
}
