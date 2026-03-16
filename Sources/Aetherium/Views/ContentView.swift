import SwiftUI
import SwiftData

// MARK: - Main Content View with Unified Navigation

struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject var securityManager: SecurityManager
    @EnvironmentObject var ollamaService: OllamaService
    @EnvironmentObject var modelOrchestrator: ModelOrchestrator
    @EnvironmentObject var themeManager: ThemeManager
    @EnvironmentObject var shortcutManager: ShortcutManager
    @ObservedObject private var appSettings = AppSettings.shared

    @Query(sort: \AetheriumProject.updatedAt, order: .reverse)
    private var projects: [AetheriumProject]

    @State private var selectedProject: AetheriumProject?
    @State private var selectedView: NavigationView = .dashboard
    @State private var showingNewProjectSheet = false
    @State private var showingSettings = false

    var body: some View {
        Group {
            if appSettings.tabPosition == .top {
                topTabLayout
            } else {
                sidebarLayout
            }
        }
        .sheet(isPresented: $showingNewProjectSheet) {
            NewProjectSheet(isPresented: $showingNewProjectSheet)
        }
        .sheet(isPresented: $showingSettings) {
            SettingsView()
                .environmentObject(themeManager)
                .environmentObject(shortcutManager)
        }
        .toolbar {
            ToolbarItem(placement: .automatic) {
                GlobalModelPicker(ollamaService: ollamaService, appSettings: appSettings)
            }

            ToolbarItem(placement: .automatic) {
                Menu {
                    Button("App Settings") {
                        showingSettings = true
                    }
                    .keyboardShortcut(",", modifiers: .command)

                    Divider()

                    Button("Lock Aetherium") {
                        securityManager.logout()
                    }

                    Divider()

                    Button("Check Ollama Status") {
                        Task {
                            _ = await ollamaService.checkAvailability()
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
            let available = await ollamaService.checkAvailability()
            if available {
                _ = try? await ollamaService.fetchAvailableModels()
            }
        }
        .commandPalette(onNavigate: handleSearchNavigation)
        .background {
            Button("") {
                themeManager.isSidebarCollapsed.toggle()
            }
            .keyboardShortcut(shortcutManager.toggleSidebarKeyEquivalent, modifiers: shortcutManager.toggleSidebarModifiers)
            .opacity(0).frame(width: 0, height: 0)
        }
        .keyboardShortcut(shortcutManager.searchKeyEquivalent, modifiers: shortcutManager.searchModifiers)
    }

    // MARK: - Top Tab Layout

    private var topTabLayout: some View {
        VStack(spacing: 0) {
            // Project tabs bar
            ProjectTabBar(
                projects: projects,
                selectedProject: $selectedProject,
                showingNewProjectSheet: $showingNewProjectSheet
            )

            Divider()

            if selectedProject != nil {
                // Navigation tab bar
                NavigationTabBar(selectedView: $selectedView)

                Divider()

                // Content
                if let project = selectedProject {
                    DetailViewRouter(
                        project: project,
                        selectedView: selectedView,
                        modelContext: modelContext
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                WelcomeView(
                    onCreateProject: { showingNewProjectSheet = true },
                    hasProjects: !projects.isEmpty
                )
            }
        }
    }

    // MARK: - Sidebar Layout

    private var sidebarLayout: some View {
        NavigationSplitView {
            VStack(spacing: 0) {
                ProjectSelectorView(
                    projects: projects,
                    selectedProject: $selectedProject,
                    showingNewProjectSheet: $showingNewProjectSheet
                )

                Divider()

                if selectedProject != nil {
                    SidebarNavigationMenuView(selectedView: $selectedView)
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
    }

    // MARK: - Command Palette Navigation

    private func handleSearchNavigation(_ result: SearchResult) {
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
    case plugins = "Plugins"
    case modelComparison = "Compare Models"

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
        case .plugins: return "puzzlepiece.extension"
        case .modelComparison: return "scale.3d"
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
        case .plugins: return "8"
        case .modelComparison: return "9"
        }
    }
}

// MARK: - Project Selector

struct ProjectSelectorView: View {
    let projects: [AetheriumProject]
    @Binding var selectedProject: AetheriumProject?
    @Binding var showingNewProjectSheet: Bool
    @EnvironmentObject var shortcutManager: ShortcutManager

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
                .keyboardShortcut(shortcutManager.newProjectKeyEquivalent, modifiers: shortcutManager.newProjectModifiers)
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
    let project: AetheriumProject

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

// MARK: - Project Tab Bar (Horizontal)

struct ProjectTabBar: View {
    let projects: [AetheriumProject]
    @Binding var selectedProject: AetheriumProject?
    @Binding var showingNewProjectSheet: Bool

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                ForEach(projects) { project in
                    ProjectTab(
                        project: project,
                        isSelected: selectedProject?.id == project.id,
                        onSelect: { selectedProject = project }
                    )
                }

                // New project button
                Button(action: { showingNewProjectSheet = true }) {
                    Image(systemName: "plus")
                        .font(.system(size: 14))
                        .foregroundColor(.secondary)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("New Project (Cmd+N)")
                .keyboardShortcut("n", modifiers: .command)
                .padding(.horizontal, 4)

                Spacer()
            }
            .padding(.horizontal, 8)
        }
        .frame(height: 40)
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

struct ProjectTab: View {
    let project: AetheriumProject
    let isSelected: Bool
    let onSelect: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 6) {
                Image(systemName: "folder.fill")
                    .font(.system(size: 12))

                Text(project.title)
                    .font(.system(size: 13))
                    .lineLimit(1)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(
                isSelected
                    ? Color.accentColor.opacity(0.15)
                    : isHovering ? Color.secondary.opacity(0.1) : Color.clear
            )
            .cornerRadius(6)
        }
        .buttonStyle(.plain)
        .onHover { hovering in isHovering = hovering }
    }
}

// MARK: - Navigation Tab Bar (Horizontal, below project tabs)

struct NavigationTabBar: View {
    @Binding var selectedView: NavigationView

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                ForEach(NavigationView.allCases) { view in
                    NavigationTab(
                        view: view,
                        isSelected: selectedView == view,
                        onSelect: { selectedView = view }
                    )
                }

                Spacer()
            }
            .padding(.horizontal, 8)
        }
        .frame(height: 44)
        .background(Color(nsColor: .controlBackgroundColor))
    }
}

struct NavigationTab: View {
    let view: NavigationView
    let isSelected: Bool
    let onSelect: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 6) {
                Image(systemName: view.icon)
                    .font(.system(size: 14))

                Text(view.rawValue)
                    .font(.system(size: 13, weight: isSelected ? .semibold : .regular))
            }
            .foregroundColor(isSelected ? .accentColor : .primary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                isSelected
                    ? Color.accentColor.opacity(0.12)
                    : isHovering ? Color.secondary.opacity(0.08) : Color.clear
            )
            .cornerRadius(6)
        }
        .buttonStyle(.plain)
        .keyboardShortcut(view.keyboardShortcut ?? " ", modifiers: .command)
        .onHover { hovering in isHovering = hovering }
    }
}

// MARK: - Sidebar Navigation Menu

struct SidebarNavigationMenuView: View {
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
        ZStack {
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
                KnowledgeGraphView(project: project)

            case .flashcards:
                FlashcardReviewView(project: project, modelContext: modelContext)

            case .learningPaths:
                LearningPathView(project: project)

            case .plugins:
                PluginManagerView()

            case .modelComparison:
                ModelComparisonView(project: project)
            }
        }
        .navigationTitle(selectedView.rawValue)
    }
}

// MARK: - Chat Navigation View

struct ChatNavigationView: View {
    let project: AetheriumProject
    @State private var selectedChat: ChatSession?

    var body: some View {
        HSplitView {
            // Chat list
            VStack(spacing: 0) {
                ChatSessionListHeaderView(project: project)
                    .environmentObject(shortcutManager)

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
                ChatView(chatSession: chat) { branchedSession in
                                selectedChat = branchedSession
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailableView(
                    "No Chat Selected",
                    systemImage: "message.badge.questionmark",
                    description: Text("Select a chat to start conversing")
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct ChatSessionListHeaderView: View {
    let project: AetheriumProject
    @State private var showingNewChat = false
    @EnvironmentObject var shortcutManager: ShortcutManager

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
        .keyboardShortcut(shortcutManager.newChatKeyEquivalent, modifiers: shortcutManager.newChatModifiers)
    }
}

struct ChatSessionRowView: View {
    let chat: ChatSession

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
    @EnvironmentObject var shortcutManager: ShortcutManager

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
            .keyboardShortcut(shortcutManager.newProjectKeyEquivalent, modifiers: shortcutManager.newProjectModifiers)
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
    let project: AetheriumProject
    @Binding var isPresented: Bool
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject var ollamaService: OllamaService

    @State private var title = ""
    @State private var customSystemPrompt = ""
    @State private var selectedModel = AppSettings.shared.preferredModel

    var body: some View {
        VStack(spacing: 20) {
            Text("New Chat")
                .font(.headline)

            if !ollamaService.availableModels.isEmpty {
                Picker("Model", selection: $selectedModel) {
                    ForEach(ollamaService.availableModels) { model in
                        Text(model.name).tag(model.name)
                    }
                }
            } else {
                HStack {
                    Text("Model")
                    Spacer()
                    Text(selectedModel)
                        .foregroundColor(.secondary)
                }

                Label("Start Ollama to see installed models", systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundColor(.orange)
            }

            TextField("System Prompt (optional)", text: $customSystemPrompt, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...3)

            Picker("Model", selection: $selectedModel) {
                ForEach(ollamaService.availableModels) { model in
                    Text(model.name).tag(model.name)
                }

                if ollamaService.availableModels.isEmpty {
                    Text("qwen2.5:7b").tag("qwen2.5:7b")
                    Text("llama3.2:latest").tag("llama3.2:latest")
                }
            }
            .pickerStyle(.menu)

            HStack {
                Button("Cancel") {
                    isPresented = false
                }
                .buttonStyle(.bordered)

                Button("Create") {
                    createChat()
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding()
        .frame(width: 350)
        .task {
            _ = try? await ollamaService.fetchAvailableModels()
        }
    }

    private func createChat() {
        let chat = ChatSession(
            title: title.isEmpty ? "New Chat" : title,
            modelName: selectedModel,
            isLocal: true,
            systemPrompt: customSystemPrompt.isEmpty ? nil : customSystemPrompt
        )
        chat.project = project
        modelContext.insert(chat)
        isPresented = false
    }
}

// MARK: - Global Model Picker

struct GlobalModelPicker: View {
    @ObservedObject var ollamaService: OllamaService
    @ObservedObject var appSettings: AppSettings

    var body: some View {
        Menu {
            if ollamaService.availableModels.isEmpty {
                Text("No models available")
                    .foregroundColor(.secondary)
            } else {
                ForEach(ollamaService.availableModels) { model in
                    Button {
                        appSettings.preferredModel = model.name
                    } label: {
                        HStack {
                            Text(model.name)
                            if model.name == appSettings.preferredModel {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "brain")
                Text(appSettings.preferredModel)
                    .lineLimit(1)
            }
            .font(.caption)
        }
    }
}
