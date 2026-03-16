import SwiftUI
import SwiftData

struct ChatSessionListView: View {
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject var ollamaService: OllamaService
    let project: Workspace
    @Binding var selectedChat: ChatSession?

    @State private var showingNewChatSheet = false
    @State private var showingNewGoalSheet = false

    var body: some View {
        List(selection: $selectedChat) {
            Section {
                ForEach(project.chatSessions.sorted(by: { $0.updatedAt > $1.updatedAt })) { chat in
                    SessionListRowView(chatSession: chat)
                        .tag(chat)
                        .contextMenu {
                            Button {
                                regenerateTitle(for: chat)
                            } label: {
                                Label("Regenerate Title", systemImage: "arrow.triangle.2.circlepath")
                            }
                            .disabled(chat.messages.isEmpty)

                            Divider()

                            Button("Delete Chat", role: .destructive) {
                                deleteChat(chat)
                            }
                        }
                }
            } header: {
                HStack {
                    Text("Conversations")
                    Spacer()
                    Text("\(project.chatSessions.count)")
                        .foregroundColor(.secondary)
                }
            }

            Section {
                ForEach(project.learningGoals.sorted(by: { $0.createdAt < $1.createdAt })) { goal in
                    LearningGoalRowView(goal: goal)
                }
            } header: {
                HStack {
                    Text("Learning Goals")
                    Spacer()
                    Text("\(project.learningGoals.count)")
                        .foregroundColor(.secondary)
                }
            }
        }
        .navigationTitle(project.title)
        .navigationSubtitle(project.workspaceDescription)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button(action: { showingNewChatSheet = true }) {
                        Label("New Chat", systemImage: "message")
                    }

                    Button(action: { showingNewGoalSheet = true }) {
                        Label("New Learning Goal", systemImage: "target")
                    }
                } label: {
                    Label("Add", systemImage: "plus")
                }
            }
        }
        .sheet(isPresented: $showingNewChatSheet) {
            SessionListNewChatSheet(project: project, isPresented: $showingNewChatSheet)
        }
        .sheet(isPresented: $showingNewGoalSheet) {
            NewLearningGoalSheet(project: project)
        }
    }

    private func deleteChat(_ chat: ChatSession) {
        modelContext.delete(chat)
        if selectedChat?.id == chat.id {
            selectedChat = nil
        }
    }

    private func regenerateTitle(for chat: ChatSession) {
        guard !chat.messages.isEmpty else { return }
        Task {
            do {
                let title = try await ollamaService.generateChatTitle(
                    from: chat.messages,
                    model: chat.modelName
                )
                chat.title = title
                chat.updatedAt = Date()
            } catch {
                // Silently fail
            }
        }
    }
}

struct SessionListRowView: View {
    let chatSession: ChatSession

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                if chatSession.parentMessageID != nil {
                    Image(systemName: "arrow.triangle.branch")
                        .font(.caption2)
                        .foregroundColor(.purple)
                }

                Text(chatSession.title)
                    .font(.subheadline)
                    .lineLimit(1)

                Spacer()

                if chatSession.isLocal {
                    Image(systemName: "server.rack")
                        .font(.caption2)
                        .foregroundColor(.green)
                }
            }

            HStack {
                Text(chatSession.modelName)
                    .font(.caption2)
                    .foregroundColor(.secondary)

                if let label = chatSession.branchLabel {
                    Text(label)
                        .font(.caption2)
                        .foregroundColor(.purple)
                }

                Spacer()

                Text(chatSession.updatedAt.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

struct LearningGoalRowView: View {
    let goal: LearningGoal

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: goal.progress >= 1.0 ? "checkmark.circle.fill" : "circle")
                    .foregroundColor(goal.progress >= 1.0 ? .green : .secondary)

                Text(goal.title)
                    .font(.subheadline)
            }

            ProgressView(value: goal.progress)
                .progressViewStyle(.linear)

            if !goal.goalDescription.isEmpty {
                Text(goal.goalDescription)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 4)
    }
}

struct SessionListNewChatSheet: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var ollamaService: OllamaService

    let project: Workspace
    @Binding var isPresented: Bool

    @State private var selectedModel = AppSettings.shared.preferredModel
    @State private var customTitle = ""
    @State private var customSystemPrompt = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Chat Settings") {
                    TextField("Title (optional)", text: $customTitle)
                        .textFieldStyle(.roundedBorder)

                    TextField("Custom System Prompt", text: $customSystemPrompt, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(1...5)

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
                }
            }
            .formStyle(.grouped)
            .navigationTitle("New Chat")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        createChat()
                    }
                }
            }
            .task {
                _ = try? await ollamaService.fetchAvailableModels()
            }
        }
        .frame(width: 450, height: 320)
    }

    private func createChat() {
        let newChat = ChatSession(
            modelName: selectedModel,
            isLocal: true,
            systemPrompt: customSystemPrompt.isEmpty ? nil : customSystemPrompt
        )
        newChat.project = project.projects.first
        modelContext.insert(newChat)
        dismiss()
    }
}

// MARK: - New Learning Goal Sheet

struct NewLearningGoalSheet: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    let project: Workspace

    @State private var title = ""
    @State private var goalDescription = ""

    var body: some View {
        VStack(spacing: 20) {
            Text("New Learning Goal")
                .font(.headline)

            VStack(alignment: .leading, spacing: 12) {
                TextField("Goal Title", text: $title)
                    .textFieldStyle(.roundedBorder)

                TextField("Description (optional)", text: $goalDescription, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(3...6)
            }

            HStack {
                Button("Cancel") { dismiss() }
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.cancelAction)

                Button("Create") {
                    let goal = LearningGoal(title: title, description: goalDescription)
                    goal.project = project
                    modelContext.insert(goal)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 400)
    }
}
