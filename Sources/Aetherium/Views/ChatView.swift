import SwiftUI
import SwiftData

struct ChatView: View {
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject var modelOrchestrator: ModelOrchestrator

    let chatSession: ChatSession

    @State private var messageText = ""
    @State private var isStreaming = false
    @State private var errorMessage: String?
    @FocusState private var isInputFocused: Bool

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
                            MessageBubbleView(message: message)
                                .id(message.id)
                        }

                        if isStreaming {
                            HStack {
                                ProgressView()
                                    .controlSize(.small)
                                Text("Thinking...")
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
                onSend: sendMessage
            )
        }
        .navigationTitle(chatSession.title)
        .navigationSubtitle("Using \(chatSession.modelName)")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Menu {
                    Button(action: { /* TODO: Export chat */ }) {
                        Label("Export Chat", systemImage: "square.and.arrow.up")
                    }

                    Button(action: { /* TODO: Clear history */ }) {
                        Label("Clear History", systemImage: "trash")
                    }

                    Divider()

                    Menu("Switch Model") {
                        ForEach(ModelConfiguration.defaultLocalModels) { model in
                            Button(model.displayName) {
                                chatSession.modelName = model.name
                                chatSession.updatedAt = Date()
                            }
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .onAppear {
            isInputFocused = true
        }
    }

    private func sendMessage() {
        guard !messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return
        }

        let userMessage = messageText
        messageText = ""
        errorMessage = nil

        // Add user message
        chatSession.addMessage(content: userMessage, role: .user)

        // Get AI response
        isStreaming = true

        Task {
            do {
                let context = chatSession.getContextMessages()
                let response = try await modelOrchestrator.processMessage(
                    userMessage,
                    context: context
                )

                // Add assistant message
                chatSession.addMessage(content: response, role: .assistant)
                chatSession.updatedAt = Date()

            } catch {
                errorMessage = error.localizedDescription
            }

            isStreaming = false
        }
    }
}

struct ChatHeaderView: View {
    let chatSession: ChatSession

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(chatSession.messages.count) messages")
                    .font(.caption)
                    .foregroundColor(.secondary)

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

struct MessageBubbleView: View {
    let message: Message

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if message.role == .user {
                Spacer()
            }

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

                Text(message.content)
                    .textSelection(.enabled)
                    .padding(12)
                    .background(
                        message.role == .user
                            ? Color.blue.opacity(0.1)
                            : Color.secondary.opacity(0.1)
                    )
                    .cornerRadius(12)
            }
            .frame(maxWidth: 600, alignment: message.role == .user ? .trailing : .leading)

            if message.role == .assistant {
                Spacer()
            }
        }
    }
}

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


