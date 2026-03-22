import Foundation
import SwiftData

struct TokenBudget {
    var systemPrompt: Int
    var memories: Int
    var artifacts: Int
    var summaries: Int
    var conversation: Int
    var ragContext: Int
}

struct ContextSources {
    var memoriesUsed: [String]
    var artifactsUsed: [String]
    var summariesUsed: [String]
    var documentsUsed: [String]
}

@MainActor
final class ContextAssembler {
    private let modelContext: ModelContext

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
    }

    func budgetForContextWindow(contextSize: Int) -> TokenBudget {
        let safeTotal = Int(Double(contextSize) * 0.90) // 10% safety margin
        let reservedForResponse = min(safeTotal, 2048)
        let usable = max(0, safeTotal - reservedForResponse)

        return TokenBudget(
            systemPrompt: Int(Double(usable) * 0.10),
            memories: Int(Double(usable) * 0.10),
            artifacts: Int(Double(usable) * 0.10),
            summaries: Int(Double(usable) * 0.15),
            conversation: Int(Double(usable) * 0.45),
            ragContext: Int(Double(usable) * 0.10)
        )
    }

    private func estimateTokens(text: String) -> Int {
        return text.count / 4
    }

    func assembleContext(workspaceId: UUID, sessionId: UUID, modelName: String) throws -> (messages: [Message], sources: ContextSources) {
        let contextSize = 8192
        let budget = budgetForContextWindow(contextSize: contextSize)
        
        var sources = ContextSources(memoriesUsed: [], artifactsUsed: [], summariesUsed: [], documentsUsed: [])
        var finalMessages: [Message] = []
        var systemParts: [String] = []

        // Fetch Session
        let sessionDescriptor = FetchDescriptor<ChatSession>(predicate: #Predicate { $0.id == sessionId })
        guard let session = try modelContext.fetch(sessionDescriptor).first else {
            throw AppError.notFound("Chat Session not found")
        }

        // 1. System Prompt
        if let sp = session.systemPrompt, !sp.isEmpty {
            systemParts.append(sp)
        }
        
        // Load custom project instructions
        if let projId = UUID(uuidString: session.projectId) {
            let pDesc = FetchDescriptor<Project>(predicate: #Predicate { $0.id == projId })
            if let project = try modelContext.fetch(pDesc).first, let instr = project.customInstructions, !instr.isEmpty {
                systemParts.append(instr)
            }
        }

        // 2. Memories (Top-K / Pinned)
        var memoriesText = ""
        let memDesc = FetchDescriptor<Memory>(
            predicate: #Predicate { $0.workspace?.id == workspaceId && $0.isActive == true },
            sortBy: [SortDescriptor(\.isPinned, order: .reverse), SortDescriptor(\.updatedAt, order: .reverse)]
        )
        let activeMemories = try modelContext.fetch(memDesc)
        for mem in activeMemories.prefix(10) {
            memoriesText += "- \(mem.content)\n"
            sources.memoriesUsed.append(mem.id.uuidString)
        }
        if !memoriesText.isEmpty {
            systemParts.append("Active Context/Memories:\n\(memoriesText)")
        }

        // 3. Past conversation summaries
        var summariesText = ""
        let sIdStr = sessionId.uuidString
        let sumDesc = FetchDescriptor<ConversationSummary>(
            predicate: #Predicate { $0.workspace?.id == workspaceId && $0.chatSession?.id != sessionId },
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )
        let summaries = try modelContext.fetch(sumDesc)
        for sum in summaries.prefix(3) {
            summariesText += "- \(sum.content)\n"
            sources.summariesUsed.append(sum.id.uuidString)
        }
        if !summariesText.isEmpty {
            systemParts.append("Relevant Context from Past Conversations:\n\(summariesText)")
        }

        // 4. Pinned Artifacts
        var artifactsText = ""
        let artDesc = FetchDescriptor<Artifact>(
            predicate: #Predicate { $0.workspace?.id == workspaceId && $0.isPinned == true }
        )
        let pinnedArtifacts = try modelContext.fetch(artDesc)
        for art in pinnedArtifacts.prefix(5) {
            let excerpt = String(art.content.prefix(500))
            artifactsText += "### \(art.title)\n\(excerpt)\n\n"
            sources.artifactsUsed.append(art.id.uuidString)
        }
        if !artifactsText.isEmpty {
            systemParts.append("Pinned Artifacts:\n\(artifactsText)")
        }

        // System Message
        let fullSystem = systemParts.joined(separator: "\n\n")
        if !fullSystem.isEmpty {
            finalMessages.append(Message(role: .system, content: fullSystem))
        }

        // 5. Conversation History
        let history = session.messages.sorted { $0.createdAt < $1.createdAt }
        var truncatedHistory: [Message] = []
        var currentHistoryTokens = 0

        if let first = history.first, first.role == .user {
            truncatedHistory.append(first)
            currentHistoryTokens += estimateTokens(text: first.content)
        }

        let skipFirst = truncatedHistory.isEmpty ? 0 : 1
        let remaining = Array(history.dropFirst(skipFirst))
        
        let recentCount = 4
        let recentMessages = Array(remaining.suffix(recentCount))
        let middleMessages = Array(remaining.dropLast(recentCount))

        var combined: [Message] = []
        if !truncatedHistory.isEmpty {
            combined.append(truncatedHistory[0])
        }

        for msg in middleMessages {
            let tokens = estimateTokens(text: msg.content)
            if currentHistoryTokens + tokens <= budget.conversation {
                combined.append(msg)
                currentHistoryTokens += tokens
            }
        }

        combined.append(contentsOf: recentMessages)
        finalMessages.append(contentsOf: combined)

        return (finalMessages, sources)
    }
}
