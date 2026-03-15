import XCTest
@testable import Aetherium

final class OllamaServiceTests: XCTestCase {
    var ollamaService: OllamaService!
    var session: URLSession!

    override func setUp() {
        super.setUp()
        // Set up the URLSession with MockURLProtocol
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        session = URLSession(configuration: configuration)

        ollamaService = OllamaService(session: session)
    }

    override func tearDown() {
        ollamaService = nil
        session = nil
        super.tearDown()
    }

    func testCheckAvailability_Success() async {
        // Mock a 200 OK response
        MockURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: nil
            )!
            return (response, nil)
        }

        let isAvailable = await ollamaService.checkAvailability()
        XCTAssertTrue(isAvailable, "checkAvailability should return true when server responds with 200 OK")
    }

    func testCheckAvailability_Failure() async {
        // Mock a 500 Server Error response
        MockURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 500,
                httpVersion: nil,
                headerFields: nil
            )!
            return (response, nil)
        }

        let isAvailable = await ollamaService.checkAvailability()
        XCTAssertFalse(isAvailable, "checkAvailability should return false when server responds with 500 Error")
    }

    func testFetchAvailableModels_Success() async throws {
        // Mock a valid JSON response
        let jsonString = """
        {
            "models": [
                {
                    "name": "qwen2.5:7b",
                    "modified_at": "2023-10-25T12:00:00Z",
                    "size": 4000000000,
                    "digest": "sha256:12345"
                }
            ]
        }
        """
        let data = jsonString.data(using: .utf8)

        MockURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: nil
            )!
            return (response, data)
        }

        let models = try await ollamaService.fetchAvailableModels()
        XCTAssertEqual(models.count, 1)
        XCTAssertEqual(models.first?.name, "qwen2.5:7b")
    }

    func testSendMessage_Success() async throws {
        // Mock a valid chat response
        let jsonString = """
        {
            "model": "qwen2.5:7b",
            "created_at": "2023-10-25T12:00:00Z",
            "message": {
                "role": "assistant",
                "content": "Hello there!"
            },
            "done": true
        }
        """
        let data = jsonString.data(using: .utf8)

        MockURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: nil
            )!
            return (response, data)
        }

        let responseContent = try await ollamaService.sendMessage("Hi")
        XCTAssertEqual(responseContent, "Hello there!")
    }
}
