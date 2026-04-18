import Foundation
import os

@MainActor
class LMStudioService: ObservableObject {
    @Published var isAvailable: Bool = false
    private let baseURL = "http://localhost:8080"
    private let logger = Logger(subsystem: "com.aetherium.app", category: "LMStudioService")

    func checkAvailability() async -> Bool {
        guard let url = URL(string: "\(baseURL)/health") else {
            isAvailable = false
            return false
        }

        do {
            let (_, response) = try await URLSession.shared.data(from: url)
            if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                isAvailable = true
            } else {
                isAvailable = false
            }
        } catch {
            logger.warning("LM Studio availability check failed: \(error.localizedDescription)")
            isAvailable = false
        }

        return isAvailable
    }

    func fetchAvailableModels() async -> [ModelConfiguration] {
        if !isAvailable { _ = await checkAvailability() }
        if !isAvailable { return [] }

        // Placeholder entry; real implementation should parse LM Studio model list
        return [ModelConfiguration(id: UUID(), name: "lms-default", provider: "lms", contextWindow: 8192, isLocal: true, displayName: "LM Studio")]
    }

    func generateEmbedding(_ text: String) async throws -> [Float] {
        throw ModelOrchestratorError.noModelAvailable
    }

    func sendMessage(_ content: String, model: String? = nil, context: [Message] = [], temperature: Double = 0.7, contextWindow: Int = 8192) async throws -> String {
        throw ModelOrchestratorError.cloudAPINotImplemented
    }

    func streamMessage(_ content: String, model: String? = nil, context: [Message] = []) async throws -> AsyncThrowingStream<String, Error> {
        throw ModelOrchestratorError.cloudAPINotImplemented
    }
}
