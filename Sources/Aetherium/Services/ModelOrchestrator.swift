import Foundation
import SwiftUI
import os

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

    @MainActor
    static func fromPreferred() -> ModelConfiguration {
        let name = AppSettings.shared.preferredModel
        return ModelConfiguration(
            id: UUID(),
            name: name,
            provider: "ollama",
            contextWindow: 8192,
            isLocal: true,
            displayName: name
        )
    }
}

@MainActor
class ModelOrchestrator: ObservableObject {
    @Published var preferLocalModels: Bool = true
    @Published var currentModel: ModelConfiguration
    @Published var isProcessing: Bool = false
    @Published var lastError: Error?

    private let ollamaService: OllamaService
    private let localContextWindow: Int = 8192
    private let logger = Logger(subsystem: "com.aetherium.app", category: "ModelOrchestrator")

    // API fallback services (to be implemented)
    // private let openAIService: OpenAIService?
    // private let anthropicService: AnthropicService?

    init() {
        self.ollamaService = OllamaService()
        self.currentModel = ModelConfiguration.fromPreferred()
    }

    init(ollamaService: OllamaService) {
        self.ollamaService = ollamaService
        self.currentModel = ModelConfiguration.fromPreferred()
    }

    // MARK: - Message Processing

    func processMessage(
        _ content: String,
        context: [Message],
        model: String? = nil,
        temperature: Double = 0.7
    ) async throws -> String {
        isProcessing = true
        lastError = nil

        defer {
            isProcessing = false
        }

        // 1. Check if Ollama is available
        if ollamaService.isOfflineMode {
             throw ModelOrchestratorError.offlineMode("Ollama is currently offline. Please check your connection or start the service.")
        }

        let modelName = model ?? currentModel.name
        let tokenCount = estimateTokenCount(content, context: context)

        // 2. Try local model first if preferred and within context window
        if preferLocalModels && currentModel.isLocal && tokenCount < localContextWindow {
            do {
                let response = try await ollamaService.sendMessage(
                    content,
                    model: modelName,
                    context: context,
                    temperature: temperature,
                    contextWindow: currentModel.contextWindow
                )
                return response
            } catch {
                lastError = error

                // 3. Graceful degradation: Check if error is recoverable
                if let ollamaError = error as? OllamaError {
                    switch ollamaError {
                    case .serviceUnavailable, .connectionRefused:
                        // Mark as offline to prevent immediate retries
                        ollamaService.isOfflineMode = true
                        throw ModelOrchestratorError.serviceUnreachable
                    default:
                        throw error
                    }
                }
                throw error
            }
        } else {
            // Fallback to cloud API
            // For now, just throw an error indicating cloud API not implemented
            throw ModelOrchestratorError.cloudAPINotImplemented
        }
    }

    // MARK: - Streaming Message Processing

    func processMessageStreaming(
        _ content: String,
        context: [Message],
        model: String? = nil
    ) async throws -> AsyncThrowingStream<String, Error> {
        if ollamaService.isOfflineMode {
            throw ModelOrchestratorError.offlineMode("Ollama is currently offline. Please check your connection or start the service.")
        }
        let modelName = model ?? currentModel.name
        return try await ollamaService.streamMessage(content, model: modelName, context: context)
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
            logger.info("Available Ollama models: \(available.map { $0.name })")
        } catch {
            lastError = error
            logger.error("Failed to fetch Ollama models: \(error)")
        }
    }
}

enum ModelOrchestratorError: LocalizedError {
    case contextWindowExceeded
    case cloudAPINotImplemented
    case noModelAvailable
    case serviceUnreachable
    case offlineMode(String)

    var errorDescription: String? {
        switch self {
        case .contextWindowExceeded:
            return "The conversation exceeds the model's context window"
        case .cloudAPINotImplemented:
            return "Cloud API fallback not yet implemented. Please use local models via Ollama."
        case .noModelAvailable:
            return "No suitable model available for processing"
        case .serviceUnreachable:
            return "Unable to reach the AI service. Please ensure Ollama is running."
        case .offlineMode(let message):
            return message
        }
    }
}
