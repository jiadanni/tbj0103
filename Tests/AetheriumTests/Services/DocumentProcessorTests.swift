import XCTest
@testable import Aetherium

final class DocumentProcessorTests: XCTestCase {
    var documentProcessor: DocumentProcessor!
    var ollamaService: OllamaService!
    var session: URLSession!

    @MainActor
    override func setUp() async throws {
        try await super.setUp()
        // Set up mocked OllamaService
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        session = URLSession(configuration: configuration)
        ollamaService = OllamaService(session: session)
        documentProcessor = DocumentProcessor(ollamaService: ollamaService)
    }

    override func tearDown() {
        documentProcessor = nil
        ollamaService = nil
        session = nil
        super.tearDown()
    }

    func testProcessDocument_TextFile() async throws {
        // Mock the embedding generation response for OllamaService
        let embeddingJson = """
        {
            "embedding": [0.1, 0.2, 0.3]
        }
        """
        let data = embeddingJson.data(using: .utf8)

        MockURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: nil
            )!
            return (response, data)
        }

        // Create a temporary text file
        let temporaryDirectoryURL = FileManager.default.temporaryDirectory
        let fileURL = temporaryDirectoryURL.appendingPathComponent("test_document.txt")
        let fileContent = "This is a test document content."
        try fileContent.write(to: fileURL, atomically: true, encoding: .utf8)

        // Process the document
        let uploadedDocument = try await documentProcessor.processDocument(fileURL)

        // Verify the results
        XCTAssertEqual(uploadedDocument.filename, "test_document.txt")
        XCTAssertEqual(uploadedDocument.extractedText, fileContent)
        XCTAssertFalse(uploadedDocument.chunks.isEmpty, "Document should have chunks")

        // Clean up
        try FileManager.default.removeItem(at: fileURL)
    }
}
