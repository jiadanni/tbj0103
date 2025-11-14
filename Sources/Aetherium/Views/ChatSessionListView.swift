import SwiftUI
import SwiftData

struct ChatSessionListView: View {
    @Environment(\.modelContext) private var modelContext
    @ObservedObject var project: AetheriumProject
    @Binding var selectedChat: ChatSession?

    @State private var showingNewChatSheet = false

    var body: some View {
        List(selection: $selectedChat) {
            Section {
                ForEach(project.chatSessions.sorted(by: { $0.updatedAt > $1.updatedAt })) { chat in
                    ChatSessionRowView(chatSession: chat)
                        .tag(chat)
                        .contextMenu {
                            Button("Rename Chat") {
                                // TODO: Show rename dialog
                            }

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
        .navigationSubtitle(project.projectDescription)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button(action: { showingNewChatSheet = true }) {
                        Label("New Chat", systemImage: "message")
                    }

                    Button(action: { /* TODO: Add new goal */ }) {
                        Label("New Learning Goal", systemImage: "target")
                    }
                } label: {
                    Label("Add", systemImage: "plus")
                }
            }
        }
        .sheet(isPresented: $showingNewChatSheet) {
            NewChatSheet(project: project, isPresented: $showingNewChatSheet)
        }
    }

    private func deleteChat(_ chat: ChatSession) {
        modelContext.delete(chat)
        if selectedChat?.id == chat.id {
            selectedChat = nil
        }
    }
}

struct ChatSessionRowView: View {
    let chatSession: ChatSession

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
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

struct NewChatSheet: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var ollamaService: OllamaService

    let project: AetheriumProject
    @Binding var isPresented: Bool

    @State private var selectedModel = "qwen2.5:7b"
    @State private var customTitle = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Chat Settings") {
                    TextField("Title (optional)", text: $customTitle)
                        .textFieldStyle(.roundedBorder)

                    Picker("Model", selection: $selectedModel) {
                        ForEach(ollamaService.availableModels) { model in
                            Text(model.name).tag(model.name)
                        }

                        if ollamaService.availableModels.isEmpty {
                            Text("qwen2.5:7b").tag("qwen2.5:7b")
                            Text("llama3.2:latest").tag("llama3.2:latest")
                        }
                    }
                }

                Section {
                    if ollamaService.availableModels.isEmpty {
                        Text("Could not fetch models from Ollama. Using default options.")
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
                try? await ollamaService.fetchAvailableModels()
            }
        }
        .frame(width: 450, height: 250)
    }

    private func createChat() {
        let newChat = ChatSession(
            title: customTitle.isEmpty ? "New Chat" : customTitle,
            modelName: selectedModel,
            isLocal: true
        )
        newChat.project = project
        modelContext.insert(newChat)
        dismiss()
    }
}
