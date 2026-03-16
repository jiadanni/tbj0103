import SwiftUI
import SwiftData

struct GroundedChatView: View {
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject var modelOrchestrator: ModelOrchestrator

    let chatSession: ChatSession
    var project: Workspace?
    private let ollamaService: OllamaService

    @StateObject private var groundedEngine: GroundedChatEngine
    @State private var messageText = ""
    @State private var isStreaming = false
    @State private var isGeneratingTitle = false
    @State private var errorMessage: String?
    @State private var showingSourcesPopover = false
    @State private var showingExportSheet = false
    @State private var showingClearConfirmation = false
    @FocusState private var isInputFocused: Bool

    init(chatSession: ChatSession, project: Workspace? = nil, modelOrchestrator: ModelOrchestrator, ollamaService: OllamaService) {
        self.chatSession = chatSession
        self.project = project
        self.ollamaService = ollamaService
        _groundedEngine = StateObject(wrappedValue: GroundedChatEngine(modelOrchestrator: modelOrchestrator, ollamaService: ollamaService))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Enhanced header with source info
            GroundedChatHeaderView(
                chatSession: chatSession,
                project: project,
                showingSourcesPopover: $showingSourcesPopover
            )

            Divider()

            // Messages list with citations
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 16) {
                        ForEach(chatSession.messages.sorted(by: { $0.timestamp < $1.timestamp })) { message in
                            EnhancedMessageBubbleView(message: message)
                                .id(message.id)
                        }

                        if isStreaming {
                            HStack {
                                ProgressView()
                                    .controlSize(.small)
                                Text("Researching sources and thinking...")
                                    .foregroundColor(.secondary)
                                Spacer()
                            }
                            .padding()
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
                onSend: sendGroundedMessage
            )
        }
        .navigationTitle(chatSession.title)
        .navigationSubtitle(project != nil ? "Grounded in \(project!.sources.count) sources" : "Using \(chatSession.modelName)")
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

                    if project != nil {
                        Button(action: { showingSourcesPopover.toggle() }) {
                            Label("View Sources (\(project!.sources.count))", systemImage: "doc.text")
                        }

                        Divider()
                    }

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
        .popover(isPresented: $showingSourcesPopover) {
            if let project = project {
                SourcesPopoverView(project: project)
            }
        }
        .onAppear {
            isInputFocused = true
        }
    }

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
                // Silently fail
            }
            isGeneratingTitle = false
        }
    }

    private func autoTitleIfNeeded() {
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

    // MARK: - Source-Grounded Message Sending

    private func sendGroundedMessage() {
        guard !messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return
        }

        let userMessage = messageText
        messageText = ""
        errorMessage = nil

        // Add user message
        chatSession.addMessage(content: userMessage, role: MessageRole.user)

        // Get AI response with source grounding
        isStreaming = true

        Task {
            do {
                let (response, citations) = try await groundedEngine.sendMessage(
                    userMessage,
                    in: chatSession,
                    project: project
                )

                // Add assistant message with citations
                let assistantMessage = Message(
                    content: response,
                    role: MessageRole.assistant
                )

                // Add citations
                for citation in citations {
                    citation.message = assistantMessage
                    modelContext.insert(citation)
                }

                chatSession.messages.append(assistantMessage)
                chatSession.updatedAt = Date()

                // Auto-generate a descriptive title after the first exchange
                autoTitleIfNeeded()

                // Auto-extract concepts for the knowledge graph
                let autoGen = AutoContentGenerator(ollamaService: ollamaService, modelContext: modelContext)
                Task { await autoGen.processChatExchange(userMessage: userMessage, aiResponse: response, project: project) }

            } catch {
                errorMessage = error.localizedDescription
            }

            isStreaming = false
        }
    }
}

// MARK: - Enhanced Header with Source Info

struct GroundedChatHeaderView: View {
    let chatSession: ChatSession
    let project: Workspace?
    @Binding var showingSourcesPopover: Bool

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(chatSession.messages.count) messages")
                    .font(.caption)
                    .foregroundColor(.secondary)

                if let project = project, !project.sources.isEmpty {
                    Button(action: { showingSourcesPopover.toggle() }) {
                        HStack(spacing: 6) {
                            Image(systemName: "doc.text.fill")
                            Text("\(project.sources.count) sources")
                            Image(systemName: "chevron.right")
                                .font(.caption2)
                        }
                        .font(.caption)
                        .foregroundColor(.blue)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.blue.opacity(0.1))
                        .cornerRadius(8)
                    }
                    .buttonStyle(.plain)
                }
            }

            Spacer()

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

// MARK: - Enhanced Message Bubble with Citations

struct EnhancedMessageBubbleView: View {
    let message: Message
    @State private var showingCitations = false

    var body: some View {
        VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 8) {
            // Message header
            HStack(spacing: 6) {
                Image(systemName: message.role == .user ? "person.circle.fill" : "brain.head.profile")
                    .font(.caption)

                Text(message.role == .user ? "You" : "AI")
                    .font(.caption)
                    .fontWeight(.semibold)

                Text(message.timestamp.formatted(date: .omitted, time: .shortened))
                    .font(.caption2)
                    .foregroundColor(.secondary)

                if !message.citations.isEmpty {
                    Button(action: { showingCitations.toggle() }) {
                        HStack(spacing: 2) {
                            Image(systemName: "doc.text")
                            Text("\(message.citations.count)")
                        }
                        .font(.caption2)
                        .foregroundColor(.blue)
                    }
                    .buttonStyle(.plain)
                }
            }

            // Message content
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

            // Citations (if expanded)
            if showingCitations && !message.citations.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Sources:")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(.secondary)

                    ForEach(message.citations) { citation in
                        CitationView(citation: citation)
                    }
                }
                .padding(12)
                .background(Color.blue.opacity(0.05))
                .cornerRadius(12)
            }
        }
        .frame(maxWidth: 600, alignment: message.role == .user ? .trailing : .leading)
        .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)
    }
}

// MARK: - Citation Display

struct CitationView: View {
    let citation: Citation

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: iconForSourceType(citation.sourceType))
                    .font(.caption2)
                    .foregroundColor(.blue)

                Text(citation.sourceTitle)
                    .font(.caption)
                    .fontWeight(.medium)

                if let page = citation.pageNumber {
                    Text("(p. \(page))")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }

                Spacer()

                Text(String(format: "%.0f%%", citation.relevanceScore * 100))
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }

            Text(citation.excerpt)
                .font(.caption2)
                .foregroundColor(.secondary)
                .lineLimit(2)
        }
        .padding(8)
        .background(Color.white.opacity(0.5))
        .cornerRadius(8)
    }

    private func iconForSourceType(_ type: String) -> String {
        switch type {
        case "document": return "doc.text"
        case "webpage": return "globe"
        case "audioTranscription": return "mic"
        case "note": return "note.text"
        default: return "doc"
        }
    }
}

// MARK: - Sources Popover

struct SourcesPopoverView: View {
    let project: Workspace

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Active Sources")
                .font(.headline)
                .padding(.bottom, 4)

            if project.sources.isEmpty {
                Text("No sources added yet")
                    .font(.caption)
                    .foregroundColor(.secondary)
            } else {
                ForEach(project.sources) { source in
                    HStack {
                        Image(systemName: iconForSourceType(source.type))
                            .foregroundColor(.blue)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(source.title)
                                .font(.caption)
                                .lineLimit(1)

                            Text(source.type.rawValue.capitalized)
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }

                        Spacer()
                    }
                    .padding(8)
                    .background(Color.secondary.opacity(0.1))
                    .cornerRadius(6)
                }
            }
        }
        .padding()
        .frame(width: 300)
    }

    private func iconForSourceType(_ type: ProjectSourceType) -> String {
        switch type {
        case .document: return "doc.text.fill"
        case .webpage: return "globe"
        case .audioTranscription: return "mic.fill"
        case .note: return "note.text"
        }
    }
}


