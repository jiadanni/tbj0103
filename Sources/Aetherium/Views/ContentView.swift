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
    }
}

#Preview {
    ContentView()
        .environmentObject(SecurityManager())
        .environmentObject(OllamaService())
        .environmentObject(ModelOrchestrator())
        .modelContainer(for: AetheriumProject.self, inMemory: true)
}
