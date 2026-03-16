import SwiftUI
import SwiftData

struct ChatView: View {
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject var modelOrchestrator: ModelOrchestrator
    @EnvironmentObject var ollamaService: OllamaService

    let chatSession: ChatSession
    var onBranchCreated: ((ChatSession) -> Void)?

    @State private var messageText = ""
    @State private var isStreaming = false
    @State private var streamingContent: String = ""
    @State private var isGeneratingTitle = false
    @State private var errorMessage: String?
    @State private var editingMessage: Message?
    @State private var editText = ""
    @State private var rerunModelPickerMessage: Message?
    @State private var showingExportSheet = false
    @State private var showingClearConfirmation = false
    @FocusState private var isInputFocused: Bool
    @State private var showDemoTip = false
    @EnvironmentObject var demoModeManager: DemoModeManager

    /// Build a system prompt from the chat's project custom instructions and documents.
    private var projectSystemPrompt: String? {
        guard let project = chatSession.project else { return nil }
        var parts: [String] = []
        if !project.customInstructions.isEmpty {
            parts.append("## Custom Instructions\n\(project.customInstructions)")
        }
        if !project.documents.isEmpty {
            let list = project.documents.prefix(10).map { "- \($0.title)" }.joined(separator: "\n")
            parts.append("## Project Sources\n\(list)")
        }
        return parts.isEmpty ? nil : parts.joined(separator: "\n\n")
    }

    var body: some View {
        VStack(spacing: 0) {
            // Chat header with context
            ChatHeaderView(chatSession: chatSession)

            Divider()

            // Messages list
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 16) {
                        ForEach(chatSession.messages.sorted(by: { $0.timestamp < $1.timestamp })) { message in
                            if editingMessage?.id == message.id {
                                MessageEditView(
                                    editText: $editText,
                                    onSave: { submitEdit(for: message) },
                                    onCancel: { editingMessage = nil }
                                )
                                .id(message.id)
                            } else {
                                MessageBubbleView(
                                    message: message,
                                    isStreaming: isStreaming,
                                    onEdit: { startEditing(message) },
                                    onRerun: { rerunMessage(message, withModel: nil) },
                                    onRerunWithModel: { rerunModelPickerMessage = message },
                                    onBranch: { branchFrom(message) }
                                )
                                .id(message.id)
                            }
                        }

                        if isStreaming && !streamingContent.isEmpty {
                            VStack(alignment: .leading, spacing: 6) {
                                HStack(spacing: 6) {
                                    Image(systemName: "brain.head.profile")
                                        .font(.caption)
                                    Text("AI")
                                        .font(.caption)
                                        .fontWeight(.semibold)
                                }
                                VStack(alignment: .leading, spacing: 0) {
                                    MarkdownMessageView(text: streamingContent)
                                    Text("▌").foregroundColor(.blue)
                                }
                                .textSelection(.enabled)
                                .padding(12)
                                .background(Color.secondary.opacity(0.1))
                                .cornerRadius(12)
                            }
                            .frame(maxWidth: 600, alignment: .leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .id("streaming")
                        } else if isStreaming {
                            HStack {
                                ProgressView()
                                    .controlSize(.small)
                                Text("Thinking...")
                                    .foregroundColor(.secondary)
                                Spacer()
                            }
                            .padding()
                            .id("streaming")
                        }
                    }
                    .padding()
                }
                .onChange(of: chatSession.messages.count) { _, _ in
                    if let lastMessage = chatSession.messages.last {
                        withAnimation {
                            proxy.scrollTo(lastMessage.id, anchor: .bottom)
                        }
                    }
                }
                .onChange(of: streamingContent) { _, new in
                    if !new.isEmpty {
                        withAnimation {
                            proxy.scrollTo("streaming", anchor: .bottom)
                        }
                    }
                }
            }

            // Error display
            if let error = errorMessage {
                HStack {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(.orange)
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Spacer()
                    Button("Dismiss") {
                        errorMessage = nil
                    }
                    .buttonStyle(.plain)
                    .font(.caption)
                }
                .padding()
                .background(Color.orange.opacity(0.1))
            }

            Divider()

            // Input area
            ChatInputView(
                messageText: $messageText,
                isStreaming: $isStreaming,
                isInputFocused: _isInputFocused,
                onSend: sendMessage
            )
        }
        .navigationTitle(chatSession.title)
        .navigationSubtitle(isGeneratingTitle ? "Generating title..." : "Using \(chatSession.modelName)")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Menu {
                    Button(action: { regenerateTitle() }) {
                        Label(
                            isGeneratingTitle ? "Generating..." : "Regenerate Title",
                            systemImage: "arrow.triangle.2.circlepath"
                        )
                    }
                    .disabled(chatSession.messages.isEmpty || isGeneratingTitle)

                    Button(action: { showingExportSheet = true }) {
                        Label("Export Chat", systemImage: "square.and.arrow.up")
                    }

                    Button(action: { showingClearConfirmation = true }) {
                        Label("Clear History", systemImage: "trash")
                    }
                    .disabled(chatSession.messages.isEmpty)

                    Divider()

                    Menu("Switch Model") {
                        ForEach(ollamaService.availableModels) { model in
                            Button(model.name) {
                                chatSession.modelName = model.name
                                chatSession.updatedAt = Date()
                            }
                        }

                        if ollamaService.availableModels.isEmpty {
                            Text("No models available")
                                .foregroundColor(.secondary)
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $showingExportSheet) {
            ChatExportSheet(chatSession: chatSession)
        }
        .alert("Clear Chat History?", isPresented: $showingClearConfirmation) {
            Button("Cancel", role: .cancel) { }
            Button("Clear", role: .destructive) {
                for message in chatSession.messages {
                    modelContext.delete(message)
                }
                chatSession.messages.removeAll()
                chatSession.updatedAt = Date()
            }
        } message: {
            Text("This will permanently delete all messages in this chat.")
        }
        .sheet(item: $rerunModelPickerMessage) { message in
            RerunModelPickerSheet(
                models: ollamaService.availableModels,
                currentModel: chatSession.modelName
            ) { selectedModel in
                rerunMessage(message, withModel: selectedModel)
            }
        }
        .onAppear {
            isInputFocused = true
        }
        .overlay(alignment: .bottom) {
            if showDemoTip {
                DemoTipCallout(message: "Ask a question about your sources", systemImage: "text.bubble")
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .padding(.bottom, 50)
            }
        }
        .onAppear {
            guard demoModeManager.isActive else { return }
            withAnimation(.easeIn(duration: 0.3).delay(1.0)) { showDemoTip = true }
            Task {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                withAnimation(.easeOut(duration: 0.3)) { showDemoTip = false }
            }
        }
    }

    // MARK: - Edit

    private func startEditing(_ message: Message) {
        guard message.role == .user, !isStreaming else { return }
        editingMessage = message
        editText = message.content
    }

    private func submitEdit(for message: Message) {
        let newContent = editText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !newContent.isEmpty else { return }
        editingMessage = nil

        // Remove this message and everything after it
        chatSession.truncateFrom(message)

        // Update system prompt from project instructions
        chatSession.systemPrompt = projectSystemPrompt

        // Send the edited message as new
        chatSession.addMessage(content: newContent, role: .user)
        let context = chatSession.getContextMessages()
        errorMessage = nil
        streamingContent = ""
        isStreaming = true

        Task {
            do {
                let stream = try await modelOrchestrator.processMessageStreaming(
                    newContent,
                    context: context,
                    model: chatSession.modelName
                )
                var accumulated = ""
                for try await token in stream {
                    accumulated += token
                    streamingContent = accumulated
                }
                chatSession.addMessage(content: accumulated, role: .assistant)
                chatSession.updatedAt = Date()
                streamingContent = ""
                autoTitleIfNeeded()
            } catch {
                errorMessage = error.localizedDescription
                streamingContent = ""
            }
            isStreaming = false
        }
    }

    // MARK: - Rerun

    private func rerunMessage(_ message: Message, withModel model: String?) {
        guard message.role == .user, !isStreaming else { return }

        let content = message.content
        let previousModel = chatSession.modelName

        if let model {
            chatSession.modelName = model
        }

        chatSession.truncateFrom(message)
        chatSession.systemPrompt = projectSystemPrompt
        chatSession.addMessage(content: content, role: .user)
        let context = chatSession.getContextMessages()
        errorMessage = nil
        streamingContent = ""
        isStreaming = true

        Task {
            do {
                let stream = try await modelOrchestrator.processMessageStreaming(
                    content,
                    context: context,
                    model: chatSession.modelName
                )
                var accumulated = ""
                for try await token in stream {
                    accumulated += token
                    streamingContent = accumulated
                }
                chatSession.addMessage(content: accumulated, role: .assistant)
                chatSession.updatedAt = Date()
                streamingContent = ""
            } catch {
                errorMessage = error.localizedDescription
                streamingContent = ""
                if model != nil {
                    chatSession.modelName = previousModel
                }
            }
            isStreaming = false
        }
    }

    // MARK: - Branch

    private func branchFrom(_ message: Message) {
        guard !isStreaming else { return }
        let branchSession = chatSession.branch(upTo: message, modelContext: modelContext)
        onBranchCreated?(branchSession)
    }

    // MARK: - Existing methods

    private func regenerateTitle() {
        guard !chatSession.messages.isEmpty else { return }
        isGeneratingTitle = true
        Task {
            do {
                let title = try await ollamaService.generateChatTitle(
                    from: chatSession.messages,
                    model: chatSession.modelName
                )
                chatSession.title = title
                chatSession.updatedAt = Date()
            } catch {
                // Silently fail — title stays as-is
            }
            isGeneratingTitle = false
        }
    }

    private func autoTitleIfNeeded() {
        guard chatSession.messages.count >= 2 else { return }
        let userMessages = chatSession.messages.filter { $0.role == .user }
        let assistantMessages = chatSession.messages.filter { $0.role == .assistant }
        guard userMessages.count == 1 && assistantMessages.count == 1 else { return }

        Task {
            do {
                let title = try await ollamaService.generateChatTitle(
                    from: chatSession.messages,
                    model: chatSession.modelName
                )
                chatSession.title = title
                chatSession.updatedAt = Date()
            } catch {
                // Keep the fallback truncated title
            }
        }
    }

    private func sendMessage() {
        guard !messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return
        }

        let userMessage = messageText
        messageText = ""
        errorMessage = nil

        // Update system prompt from project instructions before sending
        chatSession.systemPrompt = projectSystemPrompt

        chatSession.addMessage(content: userMessage, role: .user)
        let context = chatSession.getContextMessages()

        streamingContent = ""
        isStreaming = true

        Task {
            do {
                let stream = try await modelOrchestrator.processMessageStreaming(
                    userMessage,
                    context: context,
                    model: chatSession.modelName
                )
                var accumulated = ""
                for try await token in stream {
                    accumulated += token
                    streamingContent = accumulated
                }
                chatSession.addMessage(content: accumulated, role: .assistant)
                chatSession.updatedAt = Date()
                streamingContent = ""
                autoTitleIfNeeded()

                // Auto-extract concepts for the knowledge graph
                let autoGen = AutoContentGenerator(ollamaService: ollamaService, modelContext: modelContext)
                Task { await autoGen.processChatExchange(userMessage: userMessage, aiResponse: accumulated, project: chatSession.project?.workspace) }
            } catch {
                errorMessage = error.localizedDescription
                streamingContent = ""
            }
            isStreaming = false
        }
    }
}

// MARK: - Chat Header

struct ChatHeaderView: View {
    let chatSession: ChatSession
    @EnvironmentObject var ollamaService: OllamaService

    var body: some View {
        HStack {
            // Model picker
            Menu {
                ForEach(ollamaService.availableModels) { model in
                    Button {
                        chatSession.modelName = model.name
                        chatSession.updatedAt = Date()
                    } label: {
                        HStack {
                            Text(model.name)
                            if model.name == chatSession.modelName {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }

                if ollamaService.availableModels.isEmpty {
                    Text("No models available")
                        .foregroundColor(.secondary)
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "cpu")
                        .font(.caption)
                    Text(chatSession.modelName)
                        .font(.caption)
                        .fontWeight(.medium)
                    Image(systemName: "chevron.down")
                        .font(.caption2)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color.secondary.opacity(0.1))
                .cornerRadius(6)
            }
            .buttonStyle(.plain)

            HStack(spacing: 8) {
                Text("\(chatSession.messages.count) messages")
                    .font(.caption)
                    .foregroundColor(.secondary)

                if chatSession.branchLabel != nil {
                    Label("Branch", systemImage: "arrow.triangle.branch")
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.purple.opacity(0.1))
                        .foregroundColor(.purple)
                        .cornerRadius(6)
                }

                if let project = chatSession.project {
                    if !project.customInstructions.isEmpty {
                        Label("Instructions", systemImage: "doc.text")
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.green.opacity(0.1))
                            .foregroundColor(.green)
                            .cornerRadius(6)
                    }

                    if !project.documents.isEmpty {
                        Label("\(project.documents.count) sources", systemImage: "folder")
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.blue.opacity(0.1))
                            .foregroundColor(.blue)
                            .cornerRadius(6)
                    }
                }
            }

            Spacer()

            if !chatSession.extractedTopics.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(chatSession.extractedTopics.prefix(5), id: \.self) { topic in
                            Text(topic)
                                .font(.caption2)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.blue.opacity(0.1))
                                .cornerRadius(8)
                        }
                    }
                }
            }

            if chatSession.isLocal {
                Label("Local", systemImage: "server.rack")
                    .font(.caption)
                    .foregroundColor(.green)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.green.opacity(0.1))
                    .cornerRadius(8)
            }
        }
        .padding()
    }
}

// MARK: - Message Bubble

struct MessageBubbleView: View {
    let message: Message
    var isStreaming: Bool = false
    var onEdit: (() -> Void)?
    var onRerun: (() -> Void)?
    var onRerunWithModel: (() -> Void)?
    var onBranch: (() -> Void)?

    @State private var isHovered = false

    var body: some View {
        VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: message.role == .user ? "person.circle.fill" : "brain.head.profile")
                    .font(.caption)

                Text(message.role == .user ? "You" : "AI")
                    .font(.caption)
                    .fontWeight(.semibold)

                Text(message.timestamp.formatted(date: .omitted, time: .shortened))
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }

            Group {
                if message.role == .assistant {
                    MarkdownMessageView(text: message.content)
                } else {
                    Text(message.content)
                }
            }
            .textSelection(.enabled)
            .padding(12)
            .background(
                message.role == .user
                    ? Color.blue.opacity(0.1)
                    : Color.secondary.opacity(0.1)
            )
            .cornerRadius(12)

            // Action buttons on hover (user messages only)
            if message.role == .user && isHovered && !isStreaming {
                HStack(spacing: 12) {
                    Button(action: { onEdit?() }) {
                        Label("Edit", systemImage: "pencil")
                    }

                    Button(action: { onRerun?() }) {
                        Label("Rerun", systemImage: "arrow.clockwise")
                    }

                    Button(action: { onRerunWithModel?() }) {
                        Label("Rerun with...", systemImage: "arrow.triangle.2.circlepath")
                    }

                    Button(action: { onBranch?() }) {
                        Label("Branch", systemImage: "arrow.triangle.branch")
                    }
                }
                .font(.caption2)
                .buttonStyle(.plain)
                .foregroundColor(.secondary)
                .transition(.opacity)
            }

            // Branch button for assistant messages too
            if message.role == .assistant && isHovered && !isStreaming {
                HStack(spacing: 12) {
                    Button(action: { onBranch?() }) {
                        Label("Branch from here", systemImage: "arrow.triangle.branch")
                    }
                }
                .font(.caption2)
                .buttonStyle(.plain)
                .foregroundColor(.secondary)
                .transition(.opacity)
            }
        }
        .frame(maxWidth: 600, alignment: message.role == .user ? .trailing : .leading)
        .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.15)) {
                isHovered = hovering
            }
        }
        .contextMenu {
            if message.role == .user {
                Button(action: { onEdit?() }) {
                    Label("Edit & Resend", systemImage: "pencil")
                }

                Button(action: { onRerun?() }) {
                    Label("Rerun", systemImage: "arrow.clockwise")
                }

                Button(action: { onRerunWithModel?() }) {
                    Label("Rerun with Different Model", systemImage: "arrow.triangle.2.circlepath")
                }
            }

            Button(action: { onBranch?() }) {
                Label("Branch from Here", systemImage: "arrow.triangle.branch")
            }
        }
    }
}

// MARK: - Message Edit View

struct MessageEditView: View {
    @Binding var editText: String
    let onSave: () -> Void
    let onCancel: () -> Void
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "pencil.circle.fill")
                    .font(.caption)
                    .foregroundColor(.orange)
                Text("Editing")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundColor(.orange)
            }

            TextEditor(text: $editText)
                .font(.body)
                .padding(8)
                .frame(minHeight: 60, maxHeight: 200)
                .background(Color.orange.opacity(0.05))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.orange.opacity(0.3), lineWidth: 1)
                )
                .cornerRadius(12)
                .focused($isFocused)

            HStack(spacing: 12) {
                Button("Cancel") { onCancel() }
                    .buttonStyle(.plain)
                    .foregroundColor(.secondary)

                Button(action: onSave) {
                    Label("Save & Resend", systemImage: "arrow.up.circle.fill")
                }
                .buttonStyle(.borderedProminent)
                .disabled(editText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .font(.caption)
        }
        .frame(maxWidth: 600, alignment: .trailing)
        .frame(maxWidth: .infinity, alignment: .trailing)
        .onAppear { isFocused = true }
    }
}

// MARK: - Rerun Model Picker

struct RerunModelPickerSheet: View {
    let models: [OllamaModel]
    let currentModel: String
    let onSelect: (String) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("Select a model to rerun with") {
                    ForEach(models) { model in
                        Button {
                            dismiss()
                            onSelect(model.name)
                        } label: {
                            HStack {
                                Text(model.name)
                                Spacer()
                                if model.name == currentModel {
                                    Text("current")
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .navigationTitle("Rerun with Model")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .frame(width: 350, height: 300)
    }
}

// MARK: - Chat Input

struct ChatInputView: View {
    @Binding var messageText: String
    @Binding var isStreaming: Bool
    @FocusState var isInputFocused: Bool

    let onSend: () -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: 12) {
            TextField("Type a message...", text: $messageText, axis: .vertical)
                .textFieldStyle(.plain)
                .padding(12)
                .background(Color.secondary.opacity(0.1))
                .cornerRadius(12)
                .lineLimit(1...10)
                .focused($isInputFocused)
                .onSubmit {
                    if !isStreaming {
                        onSend()
                    }
                }

            Button(action: onSend) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 32))
                    .foregroundColor(messageText.isEmpty || isStreaming ? .gray : .blue)
            }
            .buttonStyle(.plain)
            .disabled(messageText.isEmpty || isStreaming)
        }
        .padding()
    }
}
