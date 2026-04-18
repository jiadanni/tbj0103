import SwiftData
import SwiftUI

// MARK: - Main Content View with Unified Navigation

struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject var securityManager: SecurityManager
    @EnvironmentObject var ollamaService: OllamaService
    @EnvironmentObject var modelOrchestrator: ModelOrchestrator
    @EnvironmentObject var themeManager: ThemeManager
    @EnvironmentObject var shortcutManager: ShortcutManager
    @EnvironmentObject var demoModeManager: DemoModeManager
    @ObservedObject private var appSettings = AppSettings.shared

    @Query(sort: \Workspace.updatedAt, order: .reverse)
    private var projects: [Workspace]

    @State private var selectedProject: Workspace?
    @State private var selectedView: NavigationView = .dashboard
    @State private var showingNewWorkspaceSheet = false
    @State private var showingSettings = false

    var body: some View {
        VStack(spacing: 0) {
            if demoModeManager.isActive {
                DemoBannerView(
                    onExit: {
                        demoModeManager.deactivate(
                            ollamaService: ollamaService,
                            securityManager: securityManager
                        )
                    },
                    onNavigate: { selectedView = $0 },
                    onReset: { demoModeManager.reset(ollamaService: ollamaService) }
                )
            }
            Group {
                if appSettings.tabPosition == .top {
                    topTabLayout
                } else {
                    sidebarLayout
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .sheet(isPresented: $showingNewWorkspaceSheet) {
            NewWorkspaceSheet(isPresented: $showingNewWorkspaceSheet)
        }
        .sheet(isPresented: $showingSettings) {
            SettingsView()
                .environmentObject(ollamaService)
                .environmentObject(securityManager)
                .environmentObject(themeManager)
                .environmentObject(shortcutManager)
        }
        .toolbar {
            ToolbarItem(placement: .automatic) {
                GlobalModelPicker(modelOrchestrator: modelOrchestrator, appSettings: appSettings)
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
            // Auto-select the most recently updated project if none is selected
            if selectedProject == nil, let first = projects.first {
                selectedProject = first
            }

            let available = await ollamaService.checkAvailability()
            if available {
                _ = try? await ollamaService.fetchAvailableModels()
            }
        }
        .onChange(of: projects.count) { _, newCount in
            // Select newly created project or fall back if selected was deleted
            if selectedProject == nil, let first = projects.first {
                selectedProject = first
            } else if newCount > 0, let selected = selectedProject,
                      !projects.contains(where: { $0.id == selected.id }) {
                selectedProject = projects.first
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
            WorkspaceTabBar(
                projects: projects,
                selectedProject: $selectedProject,
                showingNewWorkspaceSheet: $showingNewWorkspaceSheet
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
                    onCreateProject: { showingNewWorkspaceSheet = true },
                    hasProjects: !projects.isEmpty
                )
            }
        }
    }

    // MARK: - Sidebar Layout

    private var sidebarLayout: some View {
        NavigationSplitView {
            VStack(spacing: 0) {
                WorkspaceSelectorView(
                    projects: projects,
                    selectedProject: $selectedProject,
                    showingNewWorkspaceSheet: $showingNewWorkspaceSheet
                )

                Divider()

                if selectedProject != nil {
                    SidebarNavigationMenuView(selectedView: $selectedView)
                } else {
                    ContentUnavailableView(
                        "No Workspace Selected",
                        systemImage: "folder.badge.questionmark",
                        description: Text("Create or select a workspace to get started")
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
                    onCreateProject: { showingNewWorkspaceSheet = true },
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
                DispatchQueue.main.async {
                    selectedProject = project
                    selectedView = .chat
                }
            }

        case .documentChunk:
            if let project = projects.first(where: { project in
                project.sources.contains(where: { source in
                    source.document?.id.uuidString == result.sourceID
                })
            }) {
                DispatchQueue.main.async {
                    selectedProject = project
                    selectedView = .documents
                }
            }

        case .concept:
            if let project = projects.first(where: { project in
                project.concepts.contains(where: { $0.id.uuidString == result.sourceID })
            }) {
                DispatchQueue.main.async {
                    selectedProject = project
                    selectedView = .knowledgeGraph
                }
            }

        case .note:
            if let project = projects.first(where: { project in
                project.sources.contains(where: { $0.id.uuidString == result.sourceID })
            }) {
                DispatchQueue.main.async {
                    selectedProject = project
                    selectedView = .dailyNotes
                }
            }

        case .learningGoal:
            if let project = projects.first(where: { project in
                project.learningGoals.contains(where: { $0.id.uuidString == result.sourceID })
            }) {
                DispatchQueue.main.async {
                    selectedProject = project
                    selectedView = .learningPaths
                }
            }
        }
    }
}

// MARK: - Demo Banner

struct DemoBannerView: View {
    let onExit: () -> Void
    let onNavigate: (NavigationView) -> Void
    let onReset: () -> Void

    @State private var showingHelp = false

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "bolt.fill")
                .foregroundColor(.orange)
                .font(.caption)

            Text("Demo Mode")
                .fontWeight(.semibold)
                .font(.caption)

            Text("— changes are temporary and won't be saved")
                .font(.caption)
                .foregroundColor(.secondary)

            Spacer()

            Button {
                showingHelp = true
            } label: {
                Image(systemName: "questionmark.circle")
            }
            .font(.caption)
            .buttonStyle(.plain)
            .foregroundColor(.orange)
            .help("What can I try?")

            Button("Exit Demo", action: onExit)
                .font(.caption)
                .buttonStyle(.bordered)
                .controlSize(.mini)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.orange.opacity(0.12))
        .overlay(alignment: .bottom) {
            Divider()
        }
        .sheet(isPresented: $showingHelp) {
            DemoHelpSheet(onNavigate: onNavigate, onReset: onReset, onExit: onExit)
        }
    }
}

// MARK: - Demo Help Sheet

struct DemoHelpSheet: View {
    let onNavigate: (NavigationView) -> Void
    let onReset: () -> Void
    let onExit: () -> Void

    @Environment(\.dismiss) private var dismiss

    private struct Suggestion: Identifiable {
        let id = UUID()
        let view: NavigationView
        let title: String
        let subtitle: String
    }

    private let suggestions = [
        Suggestion(view: .chat, title: "💬 Ask a question in Chat", subtitle: "Try 'What is attention?' or 'How does MRR work?'"),
        Suggestion(view: .knowledgeGraph, title: "🧠 Explore the knowledge graph", subtitle: "Tap any node to see how concepts connect to each other"),
        Suggestion(view: .flashcards, title: "🃏 Flip a flashcard", subtitle: "Practise spaced repetition — hit Space to reveal answers"),
        Suggestion(view: .learningPaths, title: "🗺️ Review your learning path", subtitle: "See milestones and track progress across projects"),
        Suggestion(view: .documents, title: "📄 Browse your documents", subtitle: "View imported sources with their extracted text"),
        Suggestion(view: .dailyNotes, title: "📅 Read a daily note", subtitle: "Seven days of study notes are already logged")
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("What can I try?")
                        .font(.headline)
                    Text("Explore Aetherium with pre-loaded demo content")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                Spacer()
                Button("Done") { dismiss() }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
            .padding()

            Divider()

            ScrollView {
                VStack(spacing: 0) {
                    ForEach(suggestions) { suggestion in
                        Button {
                            onNavigate(suggestion.view)
                            dismiss()
                        } label: {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(suggestion.title).fontWeight(.medium)
                                    Text(suggestion.subtitle)
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .foregroundStyle(.tertiary)
                                    .font(.caption)
                            }
                            .padding(.horizontal)
                            .padding(.vertical, 10)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        Divider().padding(.leading)
                    }
                }
            }

            Divider()

            HStack {
                Button(role: .destructive) {
                    onReset()
                    dismiss()
                } label: {
                    Label("Reset Demo", systemImage: "arrow.counterclockwise")
                }
                .buttonStyle(.bordered)
                .help("Re-seed all demo data, restoring the original projects and content")

                Spacer()

                Button {
                    onExit()
                    dismiss()
                } label: {
                    Label("Exit Demo", systemImage: "xmark.circle")
                }
                .buttonStyle(.borderedProminent)
                .tint(.orange)
            }
            .padding()
        }
        .frame(minWidth: 400, idealWidth: 440)
    }
}

// MARK: - Demo Tip Callout

struct DemoTipCallout: View {
    let message: String
    let systemImage: String

    var body: some View {
        Label(message, systemImage: systemImage)
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Color.orange)
            .foregroundColor(.white)
            .clipShape(Capsule())
            .shadow(color: .black.opacity(0.25), radius: 6, y: 3)
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
    case backups = "Backups"
    case memory = "Memory"
    case thoughtQueue = "Thought Queue"
    case recycleBin = "Recycle Bin"
    case webCaptures = "Web Captures"
    case workspaceSettings = "Workspace Settings"

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
        case .backups: return "clock.arrow.circlepath"
        case .memory: return "brain"
        case .thoughtQueue: return "tray.fill"
        case .recycleBin: return "trash"
        case .webCaptures: return "globe"
        case .workspaceSettings: return "gearshape.2.fill"
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
        case .backups: return "0"
        case .memory: return nil
        case .thoughtQueue: return nil
        }
    }
}

// MARK: - Project Selector

struct WorkspaceSelectorView: View {
    let projects: [Workspace]
    @Binding var selectedProject: Workspace?
    @Binding var showingNewWorkspaceSheet: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Workspaces")
                    .font(.headline)
                    .foregroundColor(.secondary)

                Spacer()

                Button(action: { showingNewWorkspaceSheet = true }) {
                    Image(systemName: "plus.circle.fill")
                        .foregroundColor(.blue)
                }
                .buttonStyle(.plain)
                .help("Create New Workspace (Cmd+N)")
                .keyboardShortcut("n", modifiers: .command)
            }
            .padding()

            Divider()

            if projects.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "folder.badge.plus")
                        .font(.largeTitle)
                        .foregroundColor(.secondary)

                    Text("No workspaces yet")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(projects, selection: $selectedProject) { project in
                    WorkspaceRowView(project: project)
                        .tag(project)
                }
                .listStyle(.sidebar)
            }
        }
    }
}

struct WorkspaceRowView: View {
    let project: Workspace

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

struct WorkspaceTabBar: View {
    let projects: [Workspace]
    @Binding var selectedProject: Workspace?
    @Binding var showingNewWorkspaceSheet: Bool

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                ForEach(projects) { project in
                    WorkspaceTab(
                        project: project,
                        isSelected: selectedProject?.id == project.id,
                        onSelect: { selectedProject = project }
                    )
                }

                // New project button
                Button(action: { showingNewWorkspaceSheet = true }) {
                    Image(systemName: "plus")
                        .font(.system(size: 14))
                        .foregroundColor(.secondary)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("New Workspace (Cmd+N)")
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

struct WorkspaceTab: View {
    let project: Workspace
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
    let project: Workspace
    let selectedView: NavigationView
    let modelContext: ModelContext

    var body: some View {
        ZStack {
            switch selectedView {
            case .dashboard:
                ProjectDashboardView(project: project, modelContext: modelContext)

            case .chat:
                ChatNavigationView(workspace: project)

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

            case .backups:
                BackupTimelineView()

            case .memory:
                MemoryView(project: project)

            case .thoughtQueue:
                ThoughtQueueView(project: project)

            case .recycleBin:
                RecycleBinView(project: project)

            case .webCaptures:
                WebCaptureView(project: project)

            case .workspaceSettings:
                WorkspaceSettingsView()
            }
        }
        .navigationTitle(selectedView.rawValue)
    }
}

// MARK: - Chat Navigation View

struct ChatNavigationView: View {
    let workspace: Workspace
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject var shortcutManager: ShortcutManager
    @EnvironmentObject var ollamaService: OllamaService
    @State private var selectedChat: ChatSession?
    @State private var showingNewProject = false
    @State private var projectToEdit: Project?

    /// Chats attached directly to the workspace (no project).
    private var quickChats: [ChatSession] {
        workspace.directChatSessions.sorted(by: { $0.updatedAt > $1.updatedAt })
    }

    var body: some View {
        HSplitView {
            // Sidebar: Quick Chats + Projects → Chats
            VStack(spacing: 0) {
                // Header with new chat + new project buttons
                HStack {
                    Text("Chats")
                        .font(.headline)

                    Spacer()

                    Button(action: createQuickChat) {
                        Image(systemName: "plus.message.fill")
                            .foregroundColor(.blue)
                    }
                    .buttonStyle(.plain)
                    .help("New Chat")

                    Button(action: { showingNewProject = true }) {
                        Image(systemName: "folder.badge.plus")
                            .foregroundColor(.blue)
                    }
                    .buttonStyle(.plain)
                    .help("New Project")
                }
                .padding()

                Divider()

                List(selection: $selectedChat) {
                    // Quick chats section (project-less)
                    if !quickChats.isEmpty {
                        Section {
                            ForEach(quickChats) { chat in
                                ChatSessionRowView(chat: chat)
                                    .tag(chat)
                            }
                        } header: {
                            HStack {
                                Label("Chats", systemImage: "message")
                                Spacer()
                                Text("\(quickChats.count)")
                                    .foregroundColor(.secondary)
                            }
                        }
                    }

                    // Project sections
                    ForEach(workspace.projects.sorted(by: { $0.updatedAt > $1.updatedAt })) { project in
                        Section {
                            ForEach(project.chatSessions.sorted(by: { $0.updatedAt > $1.updatedAt })) { chat in
                                ChatSessionRowView(chat: chat)
                                    .tag(chat)
                            }

                            if project.chatSessions.isEmpty {
                                Text("No chats")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        } header: {
                            HStack {
                                Text(project.title)
                                Spacer()
                                Text("\(project.chatSessions.count)")
                                    .foregroundColor(.secondary)
                            }
                            .contextMenu {
                                Button("Edit Project") {
                                    projectToEdit = project
                                }

                                Button("New Chat in \(project.title)") {
                                    createChatInProject(project)
                                }
                            }
                        }
                    }

                    if workspace.projects.isEmpty && quickChats.isEmpty {
                        ContentUnavailableView(
                            "No Chats",
                            systemImage: "message",
                            description: Text("Tap + to start a new chat")
                        )
                    }
                }
                .listStyle(.sidebar)
            }
            .frame(minWidth: 220, maxWidth: 320)

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
                    description: Text("Select a chat or tap + to start one")
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .sheet(isPresented: $showingNewProject) {
            NewProjectSheet(workspace: workspace, isPresented: $showingNewProject)
        }
        .sheet(item: $projectToEdit) { project in
            EditProjectSheet(project: project)
        }
        .onAppear {
            // Auto-select first chat
            if selectedChat == nil {
                selectedChat = quickChats.first ?? workspace.projects.first?.chatSessions.sorted(by: { $0.updatedAt > $1.updatedAt }).first
            }
        }
        .keyboardShortcut(shortcutManager.newChatKeyEquivalent, modifiers: shortcutManager.newChatModifiers)
    }

    private func createQuickChat() {
        let chat = ChatSession(
            modelName: AppSettings.shared.preferredModel,
            isLocal: true
        )
        chat.workspace = workspace
        modelContext.insert(chat)
        selectedChat = chat
    }

    private func createChatInProject(_ project: Project) {
        let chat = ChatSession(
            modelName: AppSettings.shared.preferredModel,
            isLocal: true
        )
        chat.project = project
        modelContext.insert(chat)
        selectedChat = chat
    }
}

// MARK: - Project Row

struct ProjectRowView: View {
    let project: Project

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(project.title)
                .font(.body)
                .fontWeight(.medium)
                .lineLimit(1)

            HStack(spacing: 8) {
                Label("\(project.chatSessions.count)", systemImage: "message")

                if !project.customInstructions.isEmpty {
                    Image(systemName: "doc.text")
                        .foregroundColor(.green)
                }

                if !project.documents.isEmpty {
                    Label("\(project.documents.count)", systemImage: "folder")
                }
            }
            .font(.caption2)
            .foregroundColor(.secondary)
        }
        .padding(.vertical, 2)
    }
}

// MARK: - New Project Sheet

struct NewProjectSheet: View {
    let workspace: Workspace
    @Binding var isPresented: Bool
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var customInstructions = ""

    var body: some View {
        VStack(spacing: 20) {
            Text("New Project")
                .font(.headline)

            VStack(alignment: .leading, spacing: 12) {
                TextField("Project Title", text: $title)
                    .textFieldStyle(.roundedBorder)

                VStack(alignment: .leading, spacing: 4) {
                    Text("Custom Instructions")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    TextEditor(text: $customInstructions)
                        .font(.body)
                        .frame(minHeight: 80, maxHeight: 160)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(Color.secondary.opacity(0.3), lineWidth: 1)
                        )
                }
            }

            Text("Projects group related chats. Custom instructions are injected as a system prompt into every chat in this project.")
                .font(.caption)
                .foregroundColor(.secondary)

            HStack {
                Button("Cancel") {
                    dismiss()
                }
                .buttonStyle(.bordered)
                .keyboardShortcut(.cancelAction)

                Button("Create") {
                    let project = Project(
                        title: title,
                        customInstructions: customInstructions
                    )
                    project.workspace = workspace
                    modelContext.insert(project)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 480)
    }
}

// MARK: - Edit Project Sheet

struct EditProjectSheet: View {
    @Environment(\.dismiss) private var dismiss

    let project: Project

    @State private var title: String
    @State private var customInstructions: String

    init(project: Project) {
        self.project = project
        _title = State(initialValue: project.title)
        _customInstructions = State(initialValue: project.customInstructions)
    }

    var body: some View {
        VStack(spacing: 20) {
            Text("Edit Project")
                .font(.headline)

            VStack(alignment: .leading, spacing: 12) {
                TextField("Project Title", text: $title)
                    .textFieldStyle(.roundedBorder)

                VStack(alignment: .leading, spacing: 4) {
                    Text("Custom Instructions")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    TextEditor(text: $customInstructions)
                        .font(.body)
                        .frame(minHeight: 80, maxHeight: 160)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(Color.secondary.opacity(0.3), lineWidth: 1)
                        )
                }
            }

            HStack {
                Button("Cancel") { dismiss() }
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.cancelAction)

                Button("Save") {
                    project.title = title
                    project.customInstructions = customInstructions
                    project.updateTimestamp()
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 480)
    }
}

struct ChatSessionListHeaderView: View {
    let project: Project
    @State private var showingNewChat = false
    @EnvironmentObject var shortcutManager: ShortcutManager

    var body: some View {
        HStack {
            Text("Chats")
                .font(.subheadline)
                .fontWeight(.semibold)
                .foregroundColor(.secondary)

            Spacer()

            Button(action: { showingNewChat = true }) {
                Image(systemName: "plus.circle.fill")
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
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
    let project: Project
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
                if ollamaService.availableModels.isEmpty {
                    Text("No models found").tag("")
                } else {
                    ForEach(ollamaService.availableModels) { model in
                        Text(model.name).tag(model.name)
                    }
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
    @ObservedObject var modelOrchestrator: ModelOrchestrator
    @ObservedObject var appSettings: AppSettings

    var body: some View {
        Menu {
            if modelOrchestrator.availableLocalModels.isEmpty {
                Text("No models available")
                    .foregroundColor(.secondary)
            } else {
                ForEach(modelOrchestrator.availableLocalModels) { model in
                    Button {
                        appSettings.preferredModel = model.name
                    } label: {
                        HStack {
                            Text(model.displayName)
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
        .task {
            await modelOrchestrator.refreshLocalModels()
        }
    }
}
