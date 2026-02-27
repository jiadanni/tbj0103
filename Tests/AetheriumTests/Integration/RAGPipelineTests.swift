import XCTest
import SwiftData
@testable import Aetherium

final class RAGPipelineTests: XCTestCase {
    var retrievalEngine: RetrievalEngine!
    var groundedChatEngine: GroundedChatEngine!
    var ollamaService: OllamaService!
    var modelOrchestrator: ModelOrchestrator!
    var session: URLSession!
    var modelContext: ModelContext!
    var project: AetheriumProject!

    override func setUp() async throws {
        super.setUp()
        // Setup SwiftData
        let schema = Schema([
            AetheriumProject.self,
            ProjectSource.self,
            UploadedDocument.self,
            DocumentChunk.self,
            ChatSession.self,
            Message.self,
            Citation.self
        ])
        let configuration = ModelConfiguration(isStoredInMemoryOnly: true)
        let container = try ModelContainer(for: schema, configurations: [configuration])
        modelContext = ModelContext(container)

        // Setup Mocks
        let urlConfig = URLSessionConfiguration.ephemeral
        urlConfig.protocolClasses = [MockURLProtocol.self]
        session = URLSession(configuration: urlConfig)
        ollamaService = OllamaService(session: session)

        // Setup Engines
        modelOrchestrator = ModelOrchestrator(ollamaService: ollamaService)
        retrievalEngine = RetrievalEngine(ollamaService: ollamaService)
        groundedChatEngine = GroundedChatEngine(modelOrchestrator: modelOrchestrator, ollamaService: ollamaService)

        // Setup Project
        project = AetheriumProject(title: "RAG Test Project", description: "Testing RAG")
        modelContext.insert(project)
    }

    override func tearDown() {
        retrievalEngine = nil
        groundedChatEngine = nil
        ollamaService = nil
        modelOrchestrator = nil
        project = nil
        session = nil
        super.tearDown()
    }

    func testRetrieval_SemanticSearch() async throws {
        // 1. Create a document with chunks and embeddings
        let source = ProjectSource(sourceType: .document, title: "Swift Guide")
        source.project = project

        let document = UploadedDocument(
            filename: "Swift Guide.pdf",
            fileType: .pdf,
            filePath: "/tmp/test.pdf",
            extractedText: "Swift is a powerful language.",
            fileSize: 1024,
            metadata: DocumentMetadata()
        )
        source.document = document

        // Add chunk with embedding [1.0, 0.0, 0.0]
        let chunk = DocumentChunk(
            content: "Swift uses automatic reference counting.",
            embeddings: [1.0, 0.0, 0.0],
            chunkIndex: 0
        )
        document.chunks.append(chunk)
        modelContext.insert(source)
        modelContext.insert(document)
        modelContext.insert(chunk)

        // 2. Mock embedding response for query "memory management" -> [0.9, 0.1, 0.0]
        // This should have high cosine similarity with the chunk
        let embeddingResponse = """
        { "embedding": [0.9, 0.1, 0.0] }
        """
        MockURLProtocol.requestHandler = { request in
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                    embeddingResponse.data(using: .utf8))
        }

        // 3. Perform retrieval
        let results = await retrievalEngine.findRelevantChunks("memory management", in: project)

        // 4. Verify results
        XCTAssertFalse(results.isEmpty, "Should find relevant chunks")
        XCTAssertEqual(results.first?.chunk.id, chunk.id)
        XCTAssertGreaterThan(results.first?.relevanceScore ?? 0, 0.7, "Relevance score should be high")
    }

    func testGroundedChat_EndToEnd() async throws {
        // 1. Setup Chat Session
        let chatSession = ChatSession(title: "RAG Chat")
        project.chatSessions.append(chatSession)

        // 2. Mock Responses
        // We need to handle two requests:
        // a) Embedding generation for retrieval (first call)
        // b) Chat completion for the answer (second call)

        var requestCount = 0
        MockURLProtocol.requestHandler = { request in
            requestCount += 1
            if request.url?.absoluteString.contains("/api/embeddings") == true {
                // Return dummy embedding
                let json = #"{ "embedding": [0.5, 0.5, 0.0] }"#
                return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                        json.data(using: .utf8))
            } else if request.url?.absoluteString.contains("/api/chat") == true {
                // Return chat response
                let json = """
                {
                    "model": "qwen2.5:7b",
                    "created_at": "2023-10-25T12:00:00Z",
                    "message": { "role": "assistant", "content": "According to the docs..." },
                    "done": true
                }
                """
                return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                        json.data(using: .utf8))
            }
            return (HTTPURLResponse(url: request.url!, statusCode: 404, httpVersion: nil, headerFields: nil)!, nil)
        }

        // 3. Send Message
        let (response, citations) = try await groundedChatEngine.sendMessage("How does ARC work?", in: chatSession, project: project)

        // 4. Verify
        XCTAssertFalse(response.isEmpty)
        // Note: Citations might be empty if no chunks match the embedding, but the flow should complete without error.
        // In a real test we'd ensure chunks exist and match.
    }
}
