import Foundation

struct OllamaMessage: Codable {
    let role: String
    let content: String
}

struct OllamaRequest: Codable {
    let model: String
    let messages: [OllamaMessage]
    let stream: Bool
    let options: OllamaOptions?

    struct OllamaOptions: Codable {
        let temperature: Double?
        let topP: Double?
        let numCtx: Int?

        enum CodingKeys: String, CodingKey {
            case temperature
            case topP = "top_p"
            case numCtx = "num_ctx"
        }
    }
}

struct OllamaResponse: Codable {
    let model: String
    let createdAt: String
    let message: OllamaMessage
    let done: Bool
    let totalDuration: Int?
    let promptEvalCount: Int?
    let evalCount: Int?

    enum CodingKeys: String, CodingKey {
        case model
        case createdAt = "created_at"
        case message
        case done
        case totalDuration = "total_duration"
        case promptEvalCount = "prompt_eval_count"
        case evalCount = "eval_count"
    }
}

struct OllamaModel: Codable, Identifiable {
    let name: String
    let modifiedAt: String
    let size: Int64
    let digest: String

    var id: String { name }

    enum CodingKeys: String, CodingKey {
        case name
        case modifiedAt = "modified_at"
        case size
        case digest
    }
}

struct OllamaModelList: Codable {
    let models: [OllamaModel]
}

enum OllamaError: LocalizedError {
    case serviceUnavailable
    case invalidResponse
    case decodingError
    case requestFailed(String)
    case connectionRefused

    var errorDescription: String? {
        switch self {
        case .serviceUnavailable:
            return "Ollama service is not running. Please ensure Ollama is installed and running (`ollama serve`)."
        case .connectionRefused:
            return "Connection refused. Is Ollama running on port 11434?"
        case .invalidResponse:
            return "Received an invalid response structure from Ollama. The model might be hallucinating or the API changed."
        case .decodingError:
            return "Failed to decode the response from Ollama. Please check your network connection."
        case .requestFailed(let message):
            return "Ollama request failed: \(message)"
        }
    }

    var recoverySuggestion: String? {
        switch self {
        case .serviceUnavailable, .connectionRefused:
            return "Open Terminal and run 'ollama serve' to start the local AI service."
        default:
            return "Try retrying the operation."
        }
    }
}

@MainActor
class OllamaService: ObservableObject {
    @Published var isAvailable: Bool = false
    @Published var availableModels: [OllamaModel] = []

    // Offline mode detection
    @Published var isOfflineMode: Bool = false

    private let baseURL = "http://localhost:11434"
    private let session: URLSession

    init(session: URLSession? = nil) {
        if let session = session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 300 // 5 minutes for long responses
            self.session = URLSession(configuration: config)
        }
    }

    // MARK: - Health Check

    func checkAvailability() async -> Bool {
        guard let url = URL(string: "\(baseURL)/api/tags") else {
            isAvailable = false
            return false
        }

        do {
            let (_, response) = try await session.data(from: url)
            if let httpResponse = response as? HTTPURLResponse {
                isAvailable = httpResponse.statusCode == 200
                isOfflineMode = !isAvailable
                return isAvailable
            }
        } catch {
            print("Ollama availability check failed: \(error.localizedDescription)")
            isAvailable = false
            isOfflineMode = true
        }
        return false
    }

    // MARK: - Resilience

    private func performRequest<T: Decodable>(
        _ request: URLRequest,
        retryCount: Int = 3
    ) async throws -> T {
        var currentRetry = 0
        var lastError: Error?

        while currentRetry <= retryCount {
            do {
                let (data, response) = try await session.data(for: request)

                guard let httpResponse = response as? HTTPURLResponse else {
                    throw OllamaError.invalidResponse
                }

                if httpResponse.statusCode == 200 {
                    return try JSONDecoder().decode(T.self, from: data)
                } else {
                    let errorMessage = String(data: data, encoding: .utf8) ?? "Unknown error"
                    throw OllamaError.requestFailed(errorMessage)
                }
            } catch {
                lastError = error
                currentRetry += 1
                if currentRetry <= retryCount {
                    // Exponential backoff: 0.5s, 1.0s, 2.0s
                    let delay = 0.5 * pow(2.0, Double(currentRetry - 1))
                    try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                    continue
                }
            }
        }

        throw lastError ?? OllamaError.serviceUnavailable
    }

    // MARK: - Model Management

    func fetchAvailableModels() async throws -> [OllamaModel] {
        guard let url = URL(string: "\(baseURL)/api/tags") else {
            throw OllamaError.invalidResponse
        }

        do {
            let (data, response) = try await session.data(from: url)

            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                throw OllamaError.serviceUnavailable
            }

            let modelList = try JSONDecoder().decode(OllamaModelList.self, from: data)
            availableModels = modelList.models
            return modelList.models
        } catch is DecodingError {
            throw OllamaError.decodingError
        } catch {
            throw OllamaError.serviceUnavailable
        }
    }

    // MARK: - Chat Completion

    func sendMessage(
        _ content: String,
        model: String = "qwen2.5:7b",
        context: [Message] = [],
        temperature: Double = 0.7,
        contextWindow: Int = 8192
    ) async throws -> String {
        guard let url = URL(string: "\(baseURL)/api/chat") else {
            throw OllamaError.invalidResponse
        }

        // Convert context messages to Ollama format
        var ollamaMessages = context.map { message in
            OllamaMessage(role: message.role.rawValue, content: message.content)
        }

        // Add current message
        ollamaMessages.append(OllamaMessage(role: "user", content: content))

        let requestBody = OllamaRequest(
            model: model,
            messages: ollamaMessages,
            stream: false,
            options: OllamaRequest.OllamaOptions(
                temperature: temperature,
                topP: 0.9,
                numCtx: contextWindow
            )
        )

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONEncoder().encode(requestBody)

        let response: OllamaResponse = try await performRequest(urlRequest)
        return response.message.content
    }

    // MARK: - Embeddings

    func generateEmbedding(
        _ text: String,
        model: String = "nomic-embed-text"
    ) async throws -> [Float] {
        guard let url = URL(string: "\(baseURL)/api/embeddings") else {
            throw OllamaError.invalidResponse
        }

        let requestBody = EmbeddingRequest(model: model, prompt: text)

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONEncoder().encode(requestBody)

        let response: EmbeddingResponse = try await performRequest(urlRequest)
        return response.embedding
    }

    // MARK: - Streaming Support (for future implementation)

    func streamMessage(
        _ content: String,
        model: String = "qwen2.5:7b",
        context: [Message] = []
    ) async throws -> AsyncThrowingStream<String, Error> {
        // TODO: Implement streaming for better UX
        // This would use URLSession's bytes(for:) API
        fatalError("Streaming not yet implemented")
    }
}

// MARK: - Embedding Types

struct EmbeddingRequest: Codable {
    let model: String
    let prompt: String
}

struct EmbeddingResponse: Codable {
    let embedding: [Float]
}
