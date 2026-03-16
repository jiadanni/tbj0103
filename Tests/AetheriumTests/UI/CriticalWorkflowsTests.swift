import XCTest
import SwiftData
@testable import Aetherium

// MARK: - UI Logic / ViewModels (Stubbed)

// Ideally, this code would reside in the main app source,
// but for this task we are mocking the ViewModel logic within the test file
// to simulate UI interactions without a UI framework.

class MockProjectListViewModel: ObservableObject {
    @Published var projects: [Workspace] = []
    private var modelContext: ModelContext

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
        fetchProjects()
    }

    func fetchProjects() {
        let descriptor = FetchDescriptor<Workspace>()
        projects = (try? modelContext.fetch(descriptor)) ?? []
    }

    func createProject(title: String, description: String) {
        let project = Workspace(title: title, description: description)
        modelContext.insert(project)
        fetchProjects()
    }

    func deleteProject(at indexSet: IndexSet) {
        for index in indexSet {
            let project = projects[index]
            modelContext.delete(project)
        }
        fetchProjects()
    }
}

class MockChatViewModel: ObservableObject {
    @Published var messages: [Message] = []
    @Published var isSending: Bool = false

    private var chatSession: ChatSession
    private var ollamaService: OllamaService

    init(chatSession: ChatSession, ollamaService: OllamaService) {
        self.chatSession = chatSession
        self.ollamaService = ollamaService
        self.messages = chatSession.messages
    }

    func sendMessage(_ content: String) async {
        isSending = true
        defer { isSending = false }

        // Add user message
        chatSession.addMessage(content: content, role: .user)
        messages = chatSession.messages

        // Get AI response (mocked via OllamaService)
        do {
            let response = try await ollamaService.sendMessage(content, context: chatSession.getContextMessages())
            chatSession.addMessage(content: response, role: .assistant)
            messages = chatSession.messages
        } catch {
            print("Failed to send message: \(error)")
        }
    }
}


final class CriticalWorkflowsTests: XCTestCase {
    var modelContainer: ModelContainer!
    var modelContext: ModelContext!
    var ollamaService: OllamaService!
    var session: URLSession!

    @MainActor
    override func setUp() async throws {
        try await super.setUp()
        // SwiftData setup
        let schema = Schema([Workspace.self, Project.self, ChatSession.self, Message.self])
        let config = ModelConfiguration(isStoredInMemoryOnly: true)
        modelContainer = try ModelContainer(for: schema, configurations: [config])
        modelContext = ModelContext(modelContainer)

        // Mock Ollama
        let urlConfig = URLSessionConfiguration.ephemeral
        urlConfig.protocolClasses = [MockURLProtocol.self]
        session = URLSession(configuration: urlConfig)
        ollamaService = OllamaService(session: session)
    }

    override func tearDown() {
        modelContainer = nil
        modelContext = nil
        ollamaService = nil
        session = nil
        super.tearDown()
    }

    func testProjectCreationFlow() {
        let viewModel = MockProjectListViewModel(modelContext: modelContext)

        // 1. Initial State
        XCTAssertTrue(viewModel.projects.isEmpty)

        // 2. User Creates Project
        viewModel.createProject(title: "My First Project", description: "Learning Swift")

        // 3. Verify Project Added
        XCTAssertEqual(viewModel.projects.count, 1)
        XCTAssertEqual(viewModel.projects.first?.title, "My First Project")

        // 4. User Deletes Project
        viewModel.deleteProject(at: IndexSet(integer: 0))

        // 5. Verify Project Removed
        XCTAssertTrue(viewModel.projects.isEmpty)
    }

    func testChatInteractionFlow() async {
        // Setup existing project and chat
        let workspace = Workspace(title: "Chat Project", description: "Test")
        modelContext.insert(workspace)
        let project = Project(title: "General")
        project.workspace = workspace
        modelContext.insert(project)
        let chatSession = ChatSession(title: "Swift Chat")
        chatSession.project = project
        modelContext.insert(chatSession)

        let viewModel = MockChatViewModel(chatSession: chatSession, ollamaService: ollamaService)

        // Mock Response
        let responseJson = """
        {
            "model": "qwen2.5:7b",
            "created_at": "2023-10-25T12:00:00Z",
            "message": { "role": "assistant", "content": "Swift is great!" },
            "done": true
        }
        """
        MockURLProtocol.requestHandler = { request in
             return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                     responseJson.data(using: .utf8))
        }

        // 1. User sends message
        await viewModel.sendMessage("What about Swift?")

        // 2. Verify messages updated (User + Assistant)
        XCTAssertEqual(viewModel.messages.count, 2)
        XCTAssertEqual(viewModel.messages.last?.role, .assistant)
        XCTAssertEqual(viewModel.messages.last?.content, "Swift is great!")
    }
}
