import AppKit
import SwiftData
import SwiftUI
import UserNotifications

@main
struct AetheriumApp: App {
    @StateObject private var securityManager = SecurityManager()
    @StateObject private var ollamaService = OllamaService()
    @StateObject private var modelOrchestrator: ModelOrchestrator
    @StateObject private var themeManager = ThemeManager()
    @StateObject private var shortcutManager = ShortcutManager()
    @StateObject private var demoModeManager = DemoModeManager()
    @StateObject private var backupService: BackupService

    let modelContainer: ModelContainer

    init() {
        // Ensure the app runs as a regular foreground app (needed when launched as a bare executable)
        NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate(ignoringOtherApps: true)
        do {
            // Include all data models in the container
            modelContainer = try ModelContainer(
                for: Workspace.self,
                Project.self,
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
                PathMilestone.self,
                CalendarAlarm.self,
                Artifact.self,
                Memory.self,
                ThoughtQueueItem.self,
                ConversationSummary.self,
                ContextSnapshot.self,
                AIModelEntity.self,
                Folder.self,
                MemorySummary.self,
                MemorySummarySnapshot.self,
                WorkspaceGlossaryTerm.self,
                MessageVariant.self
            )
        } catch {
            // Present a minimal UI with an error instead of crashing
            do {
                modelContainer = try ModelContainer(for: Workspace.self)
            } catch {
                fatalError("Failed to initialize model container: \(error)")
            }
        }

        let ollama = OllamaService()
        _ollamaService = StateObject(wrappedValue: ollama)
        _modelOrchestrator = StateObject(wrappedValue: ModelOrchestrator(ollamaService: ollama))

        let context = modelContainer.mainContext
        _backupService = StateObject(wrappedValue: BackupService(modelContext: context))
    }

    var body: some Scene {
        WindowGroup {
            ZStack {
                Group {
                    if securityManager.isAuthenticated {
                        ContentView()
                            .environmentObject(securityManager)
                            .environmentObject(ollamaService)
                            .environmentObject(modelOrchestrator)
                            .environmentObject(themeManager)
                            .environmentObject(shortcutManager)
                            .environmentObject(demoModeManager)
                            .environmentObject(backupService)
                            .preferredColorScheme(themeManager.selectedTheme.colorScheme)
                            .tint(themeManager.accentColor.color(customColor: themeManager.customAccentColor))
                    } else {
                        AuthenticationView()
                            .environmentObject(securityManager)
                            .environmentObject(ollamaService)
                            .environmentObject(demoModeManager)
                    }
                }

                AlarmFiredOverlay()
            }
            .modelContainer(demoModeManager.demoContainer ?? modelContainer)
            // Force the entire view hierarchy to rebuild when the active container changes
            // (demo on/off or demo reset) so SwiftData contexts are cleanly re-created.
            .id(demoModeManager.containerID)
            .task {
                // Discover plugins on app launch
                await PluginManager.shared.discoverPlugins()

                // Configure alarm manager with the active model context
                let container = demoModeManager.demoContainer ?? modelContainer
                let context = ModelContext(container)
                AlarmManager.shared.configure(modelContext: context)

                // Start scheduled backups if enabled
                if AppSettings.shared.backupEnabled {
                    backupService.startScheduledBackups(
                        intervalMinutes: AppSettings.shared.backupIntervalMinutes
                    )
                }
            }
        }
        .windowStyle(.automatic)

        Settings {
            SettingsView()
                .environmentObject(ollamaService)
                .environmentObject(securityManager)
                .environmentObject(backupService)
        }

        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Workspace") {
                    // Action will be handled by view
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
