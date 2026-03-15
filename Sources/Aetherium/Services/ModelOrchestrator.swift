import Foundation
import SwiftUI

enum ModelProvider {
    case ollama
    case openAI
    case anthropic
    case perplexity
}

struct ModelConfiguration: Codable, Identifiable {
    let id: UUID
    let name: String
    let provider: String
    let contextWindow: Int
    let isLocal: Bool
    let displayName: String

    static let defaultLocalModels = [
        ModelConfiguration(
            id: UUID(),
            name: "qwen2.5:7b",
            provider: "ollama",
            contextWindow: 8192,
            isLocal: true,
            displayName: "Qwen 2.5 7B (Local)"
        ),
        ModelConfiguration(
            id: UUID(),
            name: "llama3.2:latest",
            provider: "ollama",
            contextWindow: 8192,
            isLocal: true,
            displayName: "Llama 3.2 (Local)"
        ),
        ModelConfiguration(
            id: UUID(),
            name: "mistral:latest",
            provider: "ollama",
            contextWindow: 8192,
            isLocal: true,
            displayName: "Mistral (Local)"
        )
    ]
}

@MainActor
class ModelOrchestrator: ObservableObject {
    @Published var preferLocalModels: Bool = true
    @Published var currentModel: ModelConfiguration
    @Published var isProcessing: Bool = false
    @Published var lastError: Error?

    private let ollamaService: OllamaService
    private let localContextWindow: Int = 8192

    // API fallback services (to be implemented)
    // private let openAIService: OpenAIService?
    // private let anthropicService: AnthropicService?

    init() {
        self.ollamaService = OllamaService()
        self.currentModel = ModelConfiguration.defaultLocalModels[0]
    }

    init(ollamaService: OllamaService) {
        self.ollamaService = ollamaService
        self.currentModel = ModelConfiguration.defaultLocalModels[0]
    }

    // MARK: - Message Processing

    func processMessage(
        _ content: String,
        context: [Message],
        temperature: Double = 0.7
    ) async throws -> String {
        isProcessing = true
        lastError = nil

        defer {
            isProcessing = false
        }

        let tokenCount = estimateTokenCount(content, context: context)

        // Try local model first if preferred and within context window
        if preferLocalModels && currentModel.isLocal && tokenCount < localContextWindow {
            do {
                let response = try await ollamaService.sendMessage(
                    content,
                    model: currentModel.name,
                    context: context,
                    temperature: temperature,
                    contextWindow: currentModel.contextWindow
                )
                return response
            } catch {
                lastError = error
                // Could implement automatic fallback to cloud API here
                throw error
            }
        } else {
            // Fallback to cloud API
            // For now, just throw an error indicating cloud API not implemented
            throw ModelOrchestratorError.cloudAPINotImplemented
        }
    }

    // MARK: - Token Estimation

    private func estimateTokenCount(_ message: String, context: [Message]) -> Int {
        // Simple estimation: ~4 characters per token
        // This is approximate; actual tokenization varies by model
        let messageTokens = message.count / 4

        let contextTokens = context.reduce(0) { total, msg in
            total + (msg.content.count / 4)
        }

        return messageTokens + contextTokens
    }

    // MARK: - Model Management

    func switchModel(_ model: ModelConfiguration) {
        currentModel = model
    }

    func checkLocalModelsAvailability() async {
        do {
            let available = try await ollamaService.fetchAvailableModels()
            print("Available Ollama models: \(available.map { $0.name })")
        } catch {
            lastError = error
            print("Failed to fetch Ollama models: \(error)")
        }
    }
}

enum ModelOrchestratorError: LocalizedError {
    case contextWindowExceeded
    case cloudAPINotImplemented
    case noModelAvailable

    var errorDescription: String? {
        switch self {
        case .contextWindowExceeded:
            return "The conversation exceeds the model's context window"
        case .cloudAPINotImplemented:
            return "Cloud API fallback not yet implemented. Please use local models via Ollama."
        case .noModelAvailable:
            return "No suitable model available for processing"
        }
    }
}
