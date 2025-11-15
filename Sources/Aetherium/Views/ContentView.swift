import SwiftUI
import SwiftData

struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject var securityManager: SecurityManager
    @EnvironmentObject var ollamaService: OllamaService

    @Query(sort: \AetheriumProject.updatedAt, order: .reverse)
    private var projects: [AetheriumProject]

    @State private var selectedProject: AetheriumProject?
    @State private var selectedChat: ChatSession?
    @State private var showingNewProjectSheet = false
    @State private var columnVisibility = NavigationSplitViewVisibility.all
    @State private var showingCommandPalette = false

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            // Sidebar: Project List
            ProjectListView(
                projects: projects,
                selectedProject: $selectedProject,
                showingNewProjectSheet: $showingNewProjectSheet
            )
        } content: {
            // Middle: Chat Sessions
            if let project = selectedProject {
                ChatSessionListView(
                    project: project,
                    selectedChat: $selectedChat
                )
            } else {
                ContentUnavailableView(
                    "No Project Selected",
                    systemImage: "folder.badge.questionmark",
                    description: Text("Select a project to view chats")
                )
            }
        } detail: {
            // Detail: Chat View
            if let chat = selectedChat {
                ChatView(chatSession: chat)
            } else {
                ContentUnavailableView(
                    "No Chat Selected",
                    systemImage: "message.badge.questionmark",
                    description: Text("Select a chat to start conversing")
                )
            }
        }
        .navigationSplitViewStyle(.balanced)
        .sheet(isPresented: $showingNewProjectSheet) {
            NewProjectSheet(isPresented: $showingNewProjectSheet)
        }
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Menu {
                    Button("Lock Aetherium") {
                        securityManager.logout()
                    }

                    Divider()

                    Button("Check Ollama Status") {
                        Task {
                            await ollamaService.checkAvailability()
                        }
                    }

                    if ollamaService.isAvailable {
                        Label("Ollama: Connected", systemImage: "checkmark.circle.fill")
                            .foregroundColor(.green)
                    } else {
                        Label("Ollama: Disconnected", systemImage: "xmark.circle.fill")
                            .foregroundColor(.red)
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .task {
            await ollamaService.checkAvailability()
        }
        .commandPalette(onNavigate: handleSearchNavigation)
    }

    // MARK: - Command Palette Navigation

    private func handleSearchNavigation(_ result: SearchResult) {
        // Navigate to the appropriate view based on search result type
        switch result.type {
        case .chatMessage:
            // Find and select the chat session
            if let project = projects.first(where: { project in
                project.chatSessions.contains(where: { $0.id.uuidString == result.sourceID })
            }) {
                selectedProject = project
                selectedChat = project.chatSessions.first(where: { $0.id.uuidString == result.sourceID })
            }

        case .documentChunk:
            // Select the project containing this document
            if let project = projects.first(where: { project in
                project.sources.contains(where: { source in
                    source.document?.id.uuidString == result.sourceID
                })
            }) {
                selectedProject = project
            }

        case .concept:
            // Find project with this concept
            if let project = projects.first(where: { project in
                project.concepts.contains(where: { $0.id.uuidString == result.sourceID })
            }) {
                selectedProject = project
            }

        case .note, .learningGoal:
            // Find project with this note/goal
            if let project = projects.first(where: { project in
                project.sources.contains(where: { $0.id.uuidString == result.sourceID })
            }) {
                selectedProject = project
            }
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(SecurityManager())
        .environmentObject(OllamaService())
        .environmentObject(ModelOrchestrator())
        .modelContainer(for: AetheriumProject.self, inMemory: true)
}
