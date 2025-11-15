import SwiftUI
import SwiftData

// MARK: - Main Content View with Unified Navigation

struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject var securityManager: SecurityManager
    @EnvironmentObject var ollamaService: OllamaService
    @EnvironmentObject var modelOrchestrator: ModelOrchestrator

    @Query(sort: \AetheriumProject.updatedAt, order: .reverse)
    private var projects: [AetheriumProject]

    @State private var selectedProject: AetheriumProject?
    @State private var selectedView: NavigationView = .dashboard
    @State private var showingNewProjectSheet = false

    var body: some View {
        NavigationSplitView {
            // Sidebar with project selection and navigation
            VStack(spacing: 0) {
                // Project selector
                ProjectSelectorView(
                    projects: projects,
                    selectedProject: $selectedProject,
                    showingNewProjectSheet: $showingNewProjectSheet
                )

                Divider()

                // Navigation menu
                if selectedProject != nil {
                    NavigationMenuView(selectedView: $selectedView)
                } else {
                    ContentUnavailableView(
                        "No Project Selected",
                        systemImage: "folder.badge.questionmark",
                        description: Text("Create or select a project to get started")
                    )
                }
            }
            .navigationSplitViewColumnWidth(min: 200, ideal: 250, max: 300)
        } detail: {
            // Main content area
            if let project = selectedProject {
                NavigationStack {
                    DetailViewRouter(
                        project: project,
                        selectedView: selectedView,
                        modelContext: modelContext
                    )
                }
            } else {
                WelcomeView(
                    onCreateProject: { showingNewProjectSheet = true },
                    hasProjects: !projects.isEmpty
                )
            }
        }
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

                    if let project = selectedProject {
                        Button("Project Settings") {
                            // TODO: Show settings
                        }

                        Divider()
                    }

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
        // Find and select the appropriate project
        switch result.type {
        case .chatMessage:
            if let project = projects.first(where: { project in
                project.chatSessions.contains(where: { $0.id.uuidString == result.sourceID })
            }) {
                selectedProject = project
                selectedView = .chat
            }

        case .documentChunk:
            if let project = projects.first(where: { project in
                project.sources.contains(where: { source in
                    source.document?.id.uuidString == result.sourceID
                })
            }) {
                selectedProject = project
                selectedView = .documents
            }

        case .concept:
            if let project = projects.first(where: { project in
                project.concepts.contains(where: { $0.id.uuidString == result.sourceID })
            }) {
                selectedProject = project
                selectedView = .knowledgeGraph
            }

        case .note:
            if let project = projects.first(where: { project in
                project.sources.contains(where: { $0.id.uuidString == result.sourceID })
            }) {
                selectedProject = project
                selectedView = .dailyNotes
            }

        case .learningGoal:
            if let project = projects.first(where: { project in
                project.learningGoals.contains(where: { $0.id.uuidString == result.sourceID })
            }) {
                selectedProject = project
                selectedView = .learningPaths
            }
        }
    }
}

// MARK: - Navigation View Enum

enum NavigationView: String, CaseIterable, Identifiable {
    case dashboard = "Dashboard"
    case chat = "Chat"
    case dailyNotes = "Daily Notes"
    case documents = "Documents"
    case knowledgeGraph = "Knowledge Graph"
    case flashcards = "Flashcards"
    case learningPaths = "Learning Paths"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .dashboard: return "chart.bar.fill"
        case .chat: return "message.fill"
        case .dailyNotes: return "calendar"
        case .documents: return "doc.text.fill"
        case .knowledgeGraph: return "brain.head.profile"
        case .flashcards: return "rectangle.stack.fill"
        case .learningPaths: return "map.fill"
        }
    }

    var keyboardShortcut: KeyEquivalent? {
        switch self {
        case .dashboard: return "1"
        case .chat: return "2"
        case .dailyNotes: return "3"
        case .documents: return "4"
        case .knowledgeGraph: return "5"
        case .flashcards: return "6"
        case .learningPaths: return "7"
        }
    }
}

// MARK: - Project Selector

struct ProjectSelectorView: View {
    let projects: [AetheriumProject]
    @Binding var selectedProject: AetheriumProject?
    @Binding var showingNewProjectSheet: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Projects")
                    .font(.headline)
                    .foregroundColor(.secondary)

                Spacer()

                Button(action: { showingNewProjectSheet = true }) {
                    Image(systemName: "plus.circle.fill")
                        .foregroundColor(.blue)
                }
                .buttonStyle(.plain)
                .help("Create New Project (Cmd+N)")
                .keyboardShortcut("n", modifiers: .command)
            }
            .padding()

            Divider()

            if projects.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "folder.badge.plus")
                        .font(.largeTitle)
                        .foregroundColor(.secondary)

                    Text("No projects yet")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(projects, selection: $selectedProject) { project in
                    ProjectRowView(project: project)
                        .tag(project)
                }
                .listStyle(.sidebar)
            }
        }
    }
}

struct ProjectRowView: View {
    @ObservedObject var project: AetheriumProject

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(project.title)
                .font(.body)
                .fontWeight(.medium)

            HStack(spacing: 8) {
                Label("\(project.concepts.count)", systemImage: "brain")
                Label("\(project.sources.count)", systemImage: "doc")
                Label("\(project.chatSessions.count)", systemImage: "message")
            }
            .font(.caption2)
            .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Navigation Menu

struct NavigationMenuView: View {
    @Binding var selectedView: NavigationView

    var body: some View {
        List(NavigationView.allCases, selection: $selectedView) { view in
            NavigationLink(value: view) {
                Label(view.rawValue, systemImage: view.icon)
            }
            .keyboardShortcut(view.keyboardShortcut ?? " ", modifiers: .command)
        }
        .listStyle(.sidebar)
    }
}

// MARK: - Detail View Router

struct DetailViewRouter: View {
    let project: AetheriumProject
    let selectedView: NavigationView
    let modelContext: ModelContext

    var body: some View {
        Group {
            switch selectedView {
            case .dashboard:
                ProjectDashboardView(project: project, modelContext: modelContext)

            case .chat:
                ChatNavigationView(project: project)

            case .dailyNotes:
                DailyNotesView(project: project, modelContext: modelContext)

            case .documents:
                DocumentBrowserView(project: project, ollamaService: OllamaService())
                    .environmentObject(OllamaService())

            case .knowledgeGraph:
                KnowledgeGraphView(project: project, modelContext: modelContext)

            case .flashcards:
                FlashcardReviewView(project: project, modelContext: modelContext)

            case .learningPaths:
                LearningPathView(project: project)
            }
        }
        .navigationTitle(selectedView.rawValue)
    }
}

// MARK: - Chat Navigation View

struct ChatNavigationView: View {
    @ObservedObject var project: AetheriumProject
    @State private var selectedChat: ChatSession?

    var body: some View {
        HSplitView {
            // Chat list
            VStack(spacing: 0) {
                ChatSessionListHeaderView(project: project)

                Divider()

                if project.chatSessions.isEmpty {
                    ContentUnavailableView(
                        "No Chats",
                        systemImage: "message",
                        description: Text("Start a new conversation")
                    )
                } else {
                    List(project.chatSessions, selection: $selectedChat) { chat in
                        ChatSessionRowView(chat: chat)
                            .tag(chat)
                    }
                }
            }
            .frame(minWidth: 200, maxWidth: 300)

            // Chat detail
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
    }
}

struct ChatSessionListHeaderView: View {
    @ObservedObject var project: AetheriumProject
    @State private var showingNewChat = false

    var body: some View {
        HStack {
            Text("Chats")
                .font(.headline)

            Spacer()

            Button(action: { showingNewChat = true }) {
                Image(systemName: "plus.circle.fill")
            }
            .buttonStyle(.plain)
        }
        .padding()
        .sheet(isPresented: $showingNewChat) {
            NewChatSheet(project: project, isPresented: $showingNewChat)
        }
    }
}

struct ChatSessionRowView: View {
    @ObservedObject var chat: ChatSession

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(chat.title)
                .font(.body)
                .lineLimit(1)

            Text("\(chat.messages.count) messages")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Welcome View

struct WelcomeView: View {
    let onCreateProject: () -> Void
    let hasProjects: Bool

    var body: some View {
        VStack(spacing: 32) {
            VStack(spacing: 16) {
                Image(systemName: "brain.head.profile")
                    .font(.system(size: 80))
                    .foregroundColor(.blue)

                Text("Welcome to Aetherium")
                    .font(.largeTitle)
                    .fontWeight(.bold)

                Text("Your local-first AI learning companion")
                    .font(.title3)
                    .foregroundColor(.secondary)
            }

            VStack(alignment: .leading, spacing: 16) {
                FeatureBadge(icon: "message.fill", title: "AI Chat", description: "Converse with local Ollama models")
                FeatureBadge(icon: "doc.text.fill", title: "Source Grounding", description: "Ground conversations in your documents")
                FeatureBadge(icon: "brain.head.profile", title: "Knowledge Graph", description: "Build connected concept networks")
                FeatureBadge(icon: "calendar", title: "Daily Notes", description: "Track your learning journey")
                FeatureBadge(icon: "rectangle.stack.fill", title: "Flashcards", description: "Spaced repetition learning")
                FeatureBadge(icon: "chart.bar.fill", title: "Analytics", description: "Insights and progress tracking")
            }
            .frame(maxWidth: 500)

            Button(action: onCreateProject) {
                Label(hasProjects ? "Create New Project" : "Get Started", systemImage: "plus.circle.fill")
                    .font(.title3)
                    .padding(.horizontal, 32)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .keyboardShortcut("n", modifiers: .command)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

struct FeatureBadge: View {
    let icon: String
    let title: String
    let description: String

    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundColor(.blue)
                .frame(width: 40, height: 40)
                .background(Color.blue.opacity(0.1))
                .cornerRadius(8)

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)

                Text(description)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
    }
}

// MARK: - New Chat Sheet

struct NewChatSheet: View {
    @ObservedObject var project: AetheriumProject
    @Binding var isPresented: Bool
    @Environment(\.modelContext) private var modelContext

    @State private var title = ""

    var body: some View {
        VStack(spacing: 20) {
            Text("New Chat")
                .font(.headline)

            TextField("Chat Title", text: $title)
                .textFieldStyle(.roundedBorder)

            HStack {
                Button("Cancel") {
                    isPresented = false
                }
                .buttonStyle(.bordered)

                Button("Create") {
                    createChat()
                }
                .buttonStyle(.borderedProminent)
                .disabled(title.isEmpty)
            }
        }
        .padding()
        .frame(width: 300)
    }

    private func createChat() {
        let chat = ChatSession(title: title)
        chat.project = project
        modelContext.insert(chat)
        isPresented = false
    }
}

#Preview {
    ContentView()
        .environmentObject(SecurityManager())
        .environmentObject(OllamaService())
        .environmentObject(ModelOrchestrator(ollamaService: OllamaService()))
        .modelContainer(for: AetheriumProject.self, inMemory: true)
}
