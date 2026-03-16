import SwiftUI
import SwiftData

@main
struct AetheriumApp: App {
    @StateObject private var securityManager = SecurityManager()
    @StateObject private var ollamaService = OllamaService()
    @StateObject private var modelOrchestrator: ModelOrchestrator
    @StateObject private var themeManager = ThemeManager()
    @StateObject private var shortcutManager = ShortcutManager()

    let modelContainer: ModelContainer

    init() {
        do {
            // Include all data models in the container
            modelContainer = try ModelContainer(
                for: AetheriumProject.self,
                ChatSession.self,
                LearningGoal.self,
                Message.self,
                Citation.self,
                ProjectSource.self,
                UploadedDocument.self,
                DocumentChunk.self,
                WebCapture.self,
                AudioTranscription.self,
                ProjectNote.self,
                ConceptNode.self,
                ConceptLink.self,
                ConceptMention.self,
                NoteTemplate.self,
                DailyNote.self,
                LearningCard.self,
                LearningPath.self,
                PathMilestone.self
            )
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
                        .environmentObject(themeManager)
                        .environmentObject(shortcutManager)
                        .preferredColorScheme(themeManager.selectedTheme.colorScheme)
                        .tint(themeManager.accentColor.color(customColor: themeManager.customAccentColor))
                } else {
                    AuthenticationView()
                        .environmentObject(securityManager)
                }
            }
            .modelContainer(modelContainer)
            .task {
                // Discover plugins on app launch
                await PluginManager.shared.discoverPlugins()
            }
        }
        .windowStyle(.automatic)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Project") {
                    // Action will be handled by view via keyboard shortcut
                }
                .keyboardShortcut(shortcutManager.newProjectKeyEquivalent, modifiers: shortcutManager.newProjectModifiers)

                Button("New Chat") {
                    // Action will be handled by view via keyboard shortcut
                }
                .keyboardShortcut(shortcutManager.newChatKeyEquivalent, modifiers: shortcutManager.newChatModifiers)
            }
        }
    }
}
