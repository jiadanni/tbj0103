import Foundation
import SwiftData

struct TopicTag: Codable {
    var tag: String
    var weight: Int
    var source: String
}

struct TopicSignature: Codable {
    var domainTags: [TopicTag] = []
    var manualTags: [String] = []
    var ignoredTags: [String] = []
    var intentPatterns: [String] = []
    var generatedAt: String? = nil
    var messageCountAtGen: Int? = nil
    var ollamaEnriched: Bool = false
    
    static let empty = TopicSignature()
}

@MainActor
final class TopicSignatureService {
    private let modelContext: ModelContext
    
    init(modelContext: ModelContext) {
        self.modelContext = modelContext
    }

    private let genericTags = Set([
        "code", "coding", "function", "functions", "method", "methods", "class", "classes",
        "object", "objects", "variable", "variables", "example", "examples", "question",
        "questions", "answer", "answers", "help", "explain", "explaining", "understand",
        "understanding", "learn", "learning", "guide", "tutorial", "details", "detail",
        "issue", "issues", "problem", "problems", "error", "errors", "fix", "debug",
        "implementation", "implement", "feature", "features", "system", "using", "used",
        "use", "make", "build", "create", "need", "want", "trying", "works", "work",
        "thing", "things", "stuff", "project", "projects", "app", "apps"
    ])

    private func isSpecificTopicTag(_ tag: String) -> Bool {
        if genericTags.contains(tag) { return false }
        if ["api", "sql", "css", "html", "rust", "java", "swift"].contains(tag) { return true }
        return tag.count >= 4
    }

    private func extractTags(text: String, limit: Int) -> [String] {
        // Simple word split as a naive tag generator. 
        // In reality, this might call `ConceptExtractor.swift`.
        let words = text.lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
        
        var freq: [String: Int] = [:]
        for w in words { freq[w, default: 0] += 1 }
        
        let sorted = freq.keys.sorted { freq[$0]! > freq[$1]! }
        return Array(sorted.prefix(limit))
    }

    private func extractSpecificTags(text: String, maxCount: Int) -> [String] {
        var scores: [String: Int] = [:]
        var df: [String: Int] = [:]

        let lines = text.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        for line in lines {
            let tags = extractTags(text: line, limit: 8)
            var seen = Set<String>()
            
            for (idx, tag) in tags.enumerated() {
                if !isSpecificTopicTag(tag) { continue }
                
                let weight = max(0, 10 - idx)
                let bonus = min(tag.count, 12)
                scores[tag, default: 0] += weight + bonus
                
                if seen.insert(tag).inserted {
                    df[tag, default: 0] += 1
                }
            }
        }
        
        let ranked = scores.map { (tag, score) -> (String, Int, Int) in
            (tag, score, df[tag] ?? 0)
        }.sorted { a, b in
            if a.2 != b.2 { return a.2 > b.2 } // Document freq
            if a.1 != b.1 { return a.1 > b.1 } // Score
            if a.0.count != b.0.count { return a.0.count > b.0.count }
            return a.0 < b.0
        }
        
        return Array(ranked.map { $0.0 }.prefix(maxCount))
    }

    func collectWorkspaceText(workspaceId: UUID) throws -> (String, Int) {
        let fetch = FetchDescriptor<ChatSession>(predicate: #Predicate { $0.workspace?.id == workspaceId && $0.isIncognito == false && $0.excludeFromAnalytics == false })
        let sessions = try modelContext.fetch(fetch)
        
        var count = 0
        var text = ""
        for session in sessions {
            let userMsgs = session.messages.filter { $0.role == .user }.sorted { $0.createdAt > $1.createdAt }
            for msg in userMsgs.prefix(500) {
                text += msg.content + "\n"
                count += 1
            }
        }
        return (text, count)
    }

    func generateHeuristic(text: String) -> TopicSignature {
        var tags = extractSpecificTags(text: text, maxCount: 20)
        if tags.isEmpty {
            tags = extractTags(text: text, limit: 20).filter { isSpecificTopicTag($0) }
        }
        
        var domainTags: [TopicTag] = []
        for (i, t) in tags.enumerated() {
            domainTags.append(TopicTag(tag: t, weight: max(1, 20 - i), source: "heuristic"))
        }
        
        var intentPatterns: [String] = []
        let lower = text.lowercased()
        if lower.contains("how ") || lower.contains("what ") || lower.contains("why ") { intentPatterns.append("learning") }
        if lower.contains("error") || lower.contains("bug") || lower.contains("fix") || lower.contains("issue") { intentPatterns.append("debugging") }
        if lower.contains("tutorial") || lower.contains("guide") { intentPatterns.append("tutorial") }
        if lower.contains("compare") || lower.contains("vs") || lower.contains("review") { intentPatterns.append("code-review") }

        return TopicSignature(
            domainTags: domainTags,
            manualTags: [],
            ignoredTags: [],
            intentPatterns: intentPatterns,
            generatedAt: ISO8601DateFormatter().string(from: Date()),
            messageCountAtGen: nil,
            ollamaEnriched: false
        )
    }
}
