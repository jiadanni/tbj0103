import SwiftUI
import SwiftData

@main
struct AetheriumApp: App {
    @StateObject private var securityManager = SecurityManager()
    @StateObject private var ollamaService = OllamaService()
    @StateObject private var modelOrchestrator: ModelOrchestrator

    let modelContainer: ModelContainer

    init() {
        do {
            modelContainer = try ModelContainer(for: AetheriumProject.self, ChatSession.self, LearningGoal.self, Message.self)
        } catch {
            fatalError("Failed to initialize ModelContainer: \(error)")
        }

        let ollama = OllamaService()
        _ollamaService = StateObject(wrappedValue: ollama)
        _modelOrchestrator = StateObject(wrappedValue: ModelOrchestrator(ollamaService: ollama))
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if securityManager.isAuthenticated {
                    ContentView()
                        .environmentObject(securityManager)
                        .environmentObject(ollamaService)
                        .environmentObject(modelOrchestrator)
                } else {
                    AuthenticationView()
                        .environmentObject(securityManager)
                }
            }
            .modelContainer(modelContainer)
        }
        .windowStyle(.automatic)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Project") {
                    // Action will be handled by view
                }
                .keyboardShortcut("n", modifiers: .command)

                Button("New Chat") {
                    // Action will be handled by view
                }
                .keyboardShortcut("n", modifiers: [.command, .shift])
            }
        }
    }
}
