import Foundation
import os

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
    private let logger = Logger(subsystem: "com.aetherium.app", category: "OllamaService")

    // MARK: - Embedding Cache

    private let embeddingCache = NSCache<NSString, CachedEmbeddingEntry>()
    private static let embeddingCacheTTL: TimeInterval = 3600 // 1 hour

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
            logger.warning("Ollama availability check failed: \(error.localizedDescription)")
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
        model: String? = nil,
        context: [Message] = [],
        temperature: Double = 0.7,
        contextWindow: Int = 8192
    ) async throws -> String {
        let model = model ?? AppSettings.shared.preferredModel
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

    // MARK: - Chat Title Generation

    func generateChatTitle(
        from messages: [Message],
        model: String? = nil
    ) async throws -> String {
        let model = model ?? AppSettings.shared.preferredModel
        guard let url = URL(string: "\(baseURL)/api/chat") else {
            throw OllamaError.invalidResponse
        }

        // Build a summary of the conversation for the LLM
        let conversationSummary = messages
            .sorted { $0.timestamp < $1.timestamp }
            .prefix(6)
            .map { "\($0.role.rawValue): \($0.content.prefix(200))" }
            .joined(separator: "\n")

        let prompt = """
        Generate a short, descriptive title (max 6 words) for this conversation. \
        Return ONLY the title, no quotes, no punctuation at the end, no explanation.

        Conversation:
        \(conversationSummary)
        """

        let ollamaMessages = [
            OllamaMessage(role: "system", content: "You generate concise chat titles. Respond with only the title."),
            OllamaMessage(role: "user", content: prompt)
        ]

        let requestBody = OllamaRequest(
            model: model,
            messages: ollamaMessages,
            stream: false,
            options: OllamaRequest.OllamaOptions(
                temperature: 0.3,
                topP: 0.9,
                numCtx: 2048
            )
        )

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONEncoder().encode(requestBody)

        let response: OllamaResponse = try await performRequest(urlRequest)
        // Clean up: trim whitespace, remove surrounding quotes
        var title = response.message.content
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
        // Enforce max length
        if title.count > 50 {
            title = String(title.prefix(50))
        }
        return title.isEmpty ? "New Chat" : title
    }

    // MARK: - Embeddings

    func generateEmbedding(
        _ text: String,
        model: String? = nil
    ) async throws -> [Float] {
        let resolvedModel = model ?? AppSettings.shared.preferredEmbeddingModel
        let cacheKey = NSString(string: "\(resolvedModel):\(text)")

        // Return cached result if still fresh
        if let cached = embeddingCache.object(forKey: cacheKey), !cached.isExpired {
            return cached.embedding
        }

        guard let url = URL(string: "\(baseURL)/api/embeddings") else {
            throw OllamaError.invalidResponse
        }

        let requestBody = EmbeddingRequest(model: resolvedModel, prompt: text)

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONEncoder().encode(requestBody)

        let response: EmbeddingResponse = try await performRequest(urlRequest)
        embeddingCache.setObject(CachedEmbeddingEntry(embedding: response.embedding), forKey: cacheKey)
        return response.embedding
    }

    // MARK: - Streaming

    func streamMessage(
        _ content: String,
        model: String? = nil,
        context: [Message] = []
    ) async throws -> AsyncThrowingStream<String, Error> {
        let model = model ?? AppSettings.shared.preferredModel
        guard let url = URL(string: "\(baseURL)/api/chat") else {
            throw OllamaError.invalidResponse
        }

        var ollamaMessages = context.map { OllamaMessage(role: $0.role.rawValue, content: $0.content) }
        ollamaMessages.append(OllamaMessage(role: "user", content: content))

        let requestBody = OllamaRequest(
            model: model,
            messages: ollamaMessages,
            stream: true,
            options: OllamaRequest.OllamaOptions(temperature: 0.7, topP: 0.9, numCtx: 8192)
        )

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONEncoder().encode(requestBody)

        // Capture before leaving main actor
        let urlSession = session

        return AsyncThrowingStream { continuation in
            Task {
                do {
                    let (asyncBytes, response) = try await urlSession.bytes(for: urlRequest)
                    guard let httpResponse = response as? HTTPURLResponse,
                          httpResponse.statusCode == 200 else {
                        continuation.finish(throwing: OllamaError.invalidResponse)
                        return
                    }
                    for try await line in asyncBytes.lines {
                        guard !line.isEmpty,
                              let data = line.data(using: .utf8) else { continue }
                        let chunk = try JSONDecoder().decode(OllamaResponse.self, from: data)
                        if !chunk.message.content.isEmpty {
                            continuation.yield(chunk.message.content)
                        }
                        if chunk.done { break }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
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

private class CachedEmbeddingEntry {
    let embedding: [Float]
    private let cachedAt: Date

    init(embedding: [Float]) {
        self.embedding = embedding
        self.cachedAt = Date()
    }

    var isExpired: Bool {
        Date().timeIntervalSince(cachedAt) > OllamaService.embeddingCacheTTL
    }
}
