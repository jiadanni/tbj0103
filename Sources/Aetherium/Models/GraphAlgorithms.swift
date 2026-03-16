import Foundation

/// Advanced Graph Algorithms for Aetherium Knowledge Graph
public enum GraphAlgorithms {

    // MARK: - PageRank

    /// Computes the PageRank score for each concept node to determine its importance.
    ///
    /// - Parameters:
    ///   - nodes: The array of `ConceptNode` to analyze.
    ///   - dampingFactor: The probability that a random surfer continues clicking links (default 0.85).
    ///   - maxIterations: Maximum number of iterations to run the algorithm (default 100).
    ///   - tolerance: The convergence tolerance (default 0.0001).
    /// - Returns: A dictionary mapping `ConceptNode.id` to its PageRank score.
    public static func computePageRank(nodes: [ConceptNode], dampingFactor: Double = 0.85, maxIterations: Int = 100, tolerance: Double = 0.0001) -> [UUID: Double] {
        let n = nodes.count
        guard n > 0 else { return [:] }

        var pageRanks = [UUID: Double]()
        let initialRank = 1.0 / Double(n)

        // Initialize PageRanks
        for node in nodes {
            pageRanks[node.id] = initialRank
        }

        // Create adjacency list (out-edges)
        var outEdges = [UUID: [UUID]]()
        for node in nodes {
            outEdges[node.id] = node.linkedConcepts.map { $0.id }
        }

        for _ in 0..<maxIterations {
            var newPageRanks = [UUID: Double]()
            var maxChange = 0.0

            // Calculate random walk baseline
            let randomWalkPart = (1.0 - dampingFactor) / Double(n)

            // Pre-calculate sink rank sum for this iteration (nodes with 0 out-degree)
            var sinkRankSum = 0.0
            for potentialSink in nodes {
                if (outEdges[potentialSink.id]?.count ?? 0) == 0 {
                    sinkRankSum += (pageRanks[potentialSink.id] ?? 0.0) / Double(n)
                }
            }

            for node in nodes {
                // Sum ranks from incoming links
                var rankSum = 0.0
                for incomingNode in node.backlinkedConcepts {
                    let outDegree = outEdges[incomingNode.id]?.count ?? 0
                    if outDegree > 0 {
                        rankSum += (pageRanks[incomingNode.id] ?? 0.0) / Double(outDegree)
                    }
                }

                let newRank = randomWalkPart + dampingFactor * (rankSum + sinkRankSum)
                newPageRanks[node.id] = newRank

                let change = abs(newRank - (pageRanks[node.id] ?? 0.0))
                if change > maxChange {
                    maxChange = change
                }
            }

            pageRanks = newPageRanks

            if maxChange < tolerance {
                break
            }
        }

        return pageRanks
    }

    // MARK: - Community Detection

    /// Detects communities (topic clusters) using a simple Label Propagation Algorithm.
    ///
    /// - Parameter nodes: The array of `ConceptNode` to analyze.
    /// - Returns: A dictionary mapping `ConceptNode.id` to a community identifier (String).
    public static func detectCommunities(nodes: [ConceptNode]) -> [UUID: String] {
        guard !nodes.isEmpty else { return [:] }

        // Initialize each node with its own unique community label (its UUID string)
        var communities = [UUID: String]()
        for node in nodes {
            communities[node.id] = node.id.uuidString
        }

        // Build adjacency list (undirected for community detection)
        var adj = [UUID: [UUID]]()
        for node in nodes {
            var neighbors = Set<UUID>()
            for out in node.linkedConcepts { neighbors.insert(out.id) }
            for inNode in node.backlinkedConcepts { neighbors.insert(inNode.id) }
            adj[node.id] = Array(neighbors)
        }

        let maxIterations = 20
        var hasChanged = true
        var iteration = 0

        while hasChanged && iteration < maxIterations {
            hasChanged = false
            iteration += 1

            // Process nodes in random order
            let shuffledNodes = nodes.shuffled()

            for node in shuffledNodes {
                let neighbors = adj[node.id] ?? []
                if neighbors.isEmpty { continue }

                // Count frequencies of neighbor communities
                var counts = [String: Int]()
                for neighborID in neighbors {
                    if let label = communities[neighborID] {
                        counts[label, default: 0] += 1
                    }
                }

                // Find the most frequent label among neighbors
                if let maxCount = counts.values.max() {
                    let topLabels = counts.filter { $0.value == maxCount }.map { $0.key }
                    if let bestLabel = topLabels.randomElement() {
                        if communities[node.id] != bestLabel {
                            communities[node.id] = bestLabel
                            hasChanged = true
                        }
                    }
                }
            }
        }

        // At this point, communities dictionary has cluster IDs.
        // We can rename these clusters to something friendly, or just return the IDs.
        // Returning IDs for now, or we could return the name of the highest PageRank node in that cluster.
        return communities
    }

    // MARK: - Centrality and Degree Distribution

    /// Computes the in-degree centrality (number of incoming links) for each concept.
    ///
    /// - Parameter nodes: The array of `ConceptNode` to analyze.
    /// - Returns: A dictionary mapping `ConceptNode.id` to its centrality score.
    public static func computeCentrality(nodes: [ConceptNode]) -> [UUID: Int] {
        var centrality = [UUID: Int]()
        for node in nodes {
            // Centrality here is measured as in-degree (how many links point to this node)
            centrality[node.id] = node.incomingLinks.count
        }
        return centrality
    }

    /// Computes the degree distribution (how many nodes have X number of links).
    ///
    /// - Parameter nodes: The array of `ConceptNode` to analyze.
    /// - Returns: A dictionary mapping the degree (total links) to the count of nodes with that degree.
    public static func computeDegreeDistribution(nodes: [ConceptNode]) -> [Int: Int] {
        var distribution = [Int: Int]()
        for node in nodes {
            let degree = node.outgoingLinks.count + node.incomingLinks.count
            distribution[degree, default: 0] += 1
        }
        return distribution
    }

    // MARK: - Time-based Evolution

    /// Computes the evolution of the graph over time, giving the number of nodes and links at various dates.
    ///
    /// - Parameter nodes: The array of `ConceptNode` to analyze.
    /// - Returns: An array of tuples representing (Date, Cumulative Node Count, Cumulative Link Count), sorted by Date.
    public static func computeEvolution(nodes: [ConceptNode]) -> [(Date, Int, Int)] {
        // Collect all creation events
        var events: [(date: Date, type: String)] = []

        for node in nodes {
            events.append((date: node.createdAt, type: "node"))
            for link in node.outgoingLinks {
                events.append((date: link.createdAt, type: "link"))
            }
        }

        // Sort chronologically
        let sortedEvents = events.sorted { $0.date < $1.date }

        var evolution: [(Date, Int, Int)] = []
        var nodeCount = 0
        var linkCount = 0

        // Group by day for a simpler evolution curve
        let calendar = Calendar.current
        var currentDay: Date?

        for event in sortedEvents {
            let day = calendar.startOfDay(for: event.date)

            if currentDay != day {
                if let cd = currentDay {
                    evolution.append((cd, nodeCount, linkCount))
                }
                currentDay = day
            }

            if event.type == "node" {
                nodeCount += 1
            } else {
                linkCount += 1
            }
        }

        if let cd = currentDay {
            evolution.append((cd, nodeCount, linkCount))
        }

        return evolution
    }

    // MARK: - Shortest Path

    /// Computes the shortest path between two concepts.
    ///
    /// - Parameters:
    ///   - source: The starting `ConceptNode`.
    ///   - target: The destination `ConceptNode`.
    /// - Returns: An array of `ConceptNode` representing the path from source to target, or nil if no path exists.
    public static func computeShortestPath(source: ConceptNode, target: ConceptNode) -> [ConceptNode]? {
        // BFS to find the shortest path
        if source.id == target.id { return [source] }

        var visited = Set<UUID>()
        visited.insert(source.id)

        // Optimize queue operations by using indices instead of removeFirst() repeatedly
        var queue: [(node: ConceptNode, path: [ConceptNode])] = [(source, [source])]
        var queueIndex = 0

        while queueIndex < queue.count {
            let (current, path) = queue[queueIndex]
            queueIndex += 1

            // Consider both incoming and outgoing links for traversal (undirected approach)
            let neighbors = current.linkedConcepts + current.backlinkedConcepts
            for neighbor in neighbors {
                if !visited.contains(neighbor.id) {
                    if neighbor.id == target.id {
                        return path + [neighbor]
                    }
                    visited.insert(neighbor.id)
                    queue.append((neighbor, path + [neighbor]))
                }
            }
        }

        return nil
    }
}
