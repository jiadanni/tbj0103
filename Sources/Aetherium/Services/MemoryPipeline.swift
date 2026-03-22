import Foundation
import SwiftData

@MainActor
final class MemoryPipeline {
    private let modelContext: ModelContext
    private let ollamaService: OllamaService
    
    init(modelContext: ModelContext, ollamaService: OllamaService) {
        self.modelContext = modelContext
        self.ollamaService = ollamaService
    }

    /// Runs auto memory extraction on un-incognito sessions explicitly updated recently
    func processAutoMemoryExtraction(workspaceId: UUID) async throws {
        // In Swift, we track `updatedAt` for ChatSession. 
        // We look for sessions updated in the last 5 minutes.
        let fiveMinutesAgo = Date().addingTimeInterval(-5 * 60)
        let descriptor = FetchDescriptor<ChatSession>(predicate: #Predicate {
            $0.workspace?.id == workspaceId && 
            $0.updatedAt > fiveMinutesAgo && 
            $0.isIncognito == false &&
            $0.excludeFromAnalytics == false
        })
        
        let sessions = try modelContext.fetch(descriptor)
        
        for session in sessions {
            let messages = session.messages.sorted { $0.createdAt < $1.createdAt }
            // Run extraction if session length is a multiple of 5 turns
            if !messages.isEmpty && messages.count % 5 == 0 {
                try await extractAndStoreMemories(workspaceId: workspaceId, projectId: session.projectId, sessionId: session.id, recentMessages: messages)
            }
        }
    }

    /// Core extraction logic
    func extractAndStoreMemories(workspaceId: UUID, projectId: String?, sessionId: UUID, recentMessages: [Message]) async throws {
        guard !recentMessages.isEmpty else { return }

        var conversationText = ""
        for msg in recentMessages {
            conversationText += "\(msg.role): \(msg.content)\n"
        }

        let prompt = """
        Extract any important facts, preferences, or context about the user from the following conversation.
        Format as a JSON list of strings. Only include facts that are meant to be remembered long-term.
        If there is nothing to remember, return an empty list [].

        Conversation:
        \(conversationText)
        """

        // We assume `model_id` logic uses the currently preferred model from `AppSettings`
        let modelId = AppSettings.shared.preferredModel.isEmpty ? "llama3.2" : AppSettings.shared.preferredModel
        
        // Let's use the core prompt execution from Ollama
        let messages = [Message(role: .user, content: prompt)]
        let responseStream = ollamaService.sendMessage(messages: messages, modelOverride: modelId, systemPrompt: nil)
        
        var response = ""
        for try await chunk in responseStream {
            response += chunk
        }

        // Parse JSON via simple string slicing
        guard let startIdx = response.firstIndex(of: "["),
              let endIdx = response.lastIndex(of: "]"),
              startIdx < endIdx else {
            return
        }
        
        let jsonStr = String(response[startIdx...endIdx])
        guard let data = jsonStr.data(using: .utf8),
              let facts = try? JSONDecoder().decode([String].self, from: data) else {
            return
        }

        for fact in facts {
            // Generate embedding for fact
            guard let embedding = try? await ollamaService.generateEmbedding(text: fact, model: AppSettings.shared.embeddingModel) else {
                continue
            }
            
            // Deduplication (fetch existings and map cosines)
            let existingDescriptor = FetchDescriptor<Memory>(predicate: #Predicate { $0.workspace?.id == workspaceId })
            let memories = try modelContext.fetch(existingDescriptor)
            
            let isDuplicate = memories.contains { memory in
                guard let existingEmb = memory.embeddings else { return false }
                let similarity = GraphAlgorithms.cosineSimilarity(embedding, existingEmb)
                return similarity > 0.85
            }
            
            if isDuplicate { continue }
            
            // Insert fact
            let newMemory = Memory(
                projectId: projectId ?? "",
                content: fact,
                memoryType: .fact,
                sourceSessionId: sessionId.uuidString,
                isPinned: false,
                isActive: true,
                embeddings: embedding
            )
            
            let wsDescriptor = FetchDescriptor<Workspace>(predicate: #Predicate { $0.id == workspaceId })
            if let ws = try modelContext.fetch(wsDescriptor).first {
                newMemory.workspace = ws
            }
            
            modelContext.insert(newMemory)
        }
        
        try modelContext.save()
    }
}
