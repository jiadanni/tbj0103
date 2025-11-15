import SwiftUI
import SwiftData

struct CommandPaletteView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var ollamaService: OllamaService

    @State private var query = ""
    @State private var searchEngine: SemanticSearchEngine?
    @State private var selectedResult: SearchResult?
    @FocusState private var isFocused: Bool

    let onNavigate: (SearchResult) -> Void

    var body: some View {
        VStack(spacing: 0) {
            // Search field
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.secondary)
                    .font(.title3)

                TextField("Search everything...", text: $query)
                    .textFieldStyle(.plain)
                    .font(.title3)
                    .focused($isFocused)
                    .onSubmit {
                        performSearch()
                    }

                if searchEngine?.isSearching == true {
                    ProgressView()
                        .controlSize(.small)
                }

                if !query.isEmpty {
                    Button(action: { query = "" }) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding()
            .background(Color.secondary.opacity(0.05))

            Divider()

            // Results
            if let engine = searchEngine, !engine.results.isEmpty {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(engine.results.prefix(20)) { result in
                            SearchResultRow(
                                result: result,
                                isSelected: selectedResult?.id == result.id
                            )
                            .onTapGesture {
                                selectedResult = result
                                onNavigate(result)
                                dismiss()
                            }
                            .onHover { hovering in
                                if hovering {
                                    selectedResult = result
                                }
                            }

                            Divider()
                        }
                    }
                }
            } else if query.isEmpty {
                // Empty state
                VStack(spacing: 16) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 48))
                        .foregroundColor(.secondary)

                    Text("Search across all your projects")
                        .font(.headline)

                    VStack(alignment: .leading, spacing: 8) {
                        SearchTip(icon: "doc.text", text: "Documents and PDFs")
                        SearchTip(icon: "message", text: "Chat conversations")
                        SearchTip(icon: "brain", text: "Concepts and ideas")
                        SearchTip(icon: "note.text", text: "Notes and summaries")
                    }
                    .padding(.top)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding()
            } else if searchEngine?.isSearching == true {
                // Loading state
                VStack(spacing: 16) {
                    ProgressView()
                    Text("Searching...")
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                // No results
                VStack(spacing: 16) {
                    Image(systemName: "doc.questionmark")
                        .font(.system(size: 48))
                        .foregroundColor(.secondary)

                    Text("No results found")
                        .font(.headline)

                    Text("Try a different search term")
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding()
            }

            Divider()

            // Footer
            HStack {
                Text("⌘K to search")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Spacer()

                if let engine = searchEngine, !engine.results.isEmpty {
                    Text("\(engine.results.count) results")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Text("↑↓ to navigate • ⏎ to select • esc to dismiss")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(Color.secondary.opacity(0.05))
        }
        .frame(width: 600, height: 500)
        .background(.ultraThinMaterial)
        .cornerRadius(12)
        .shadow(radius: 20)
        .onAppear {
            isFocused = true
            searchEngine = SemanticSearchEngine(
                ollamaService: ollamaService,
                modelContext: modelContext
            )
        }
        .onChange(of: query) { _, newValue in
            if !newValue.isEmpty && newValue.count >= 3 {
                performSearch()
            }
        }
    }

    private func performSearch() {
        guard !query.isEmpty, let engine = searchEngine else { return }

        Task {
            do {
                try await engine.search(query)
            } catch {
                print("Search failed: \(error)")
            }
        }
    }
}

struct SearchResultRow: View {
    let result: SearchResult
    let isSelected: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Icon
            Image(systemName: result.iconName)
                .font(.title3)
                .foregroundColor(colorForType(result.type))
                .frame(width: 32, height: 32)
                .background(colorForType(result.type).opacity(0.1))
                .cornerRadius(6)

            // Content
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(result.title)
                        .font(.headline)
                        .lineLimit(1)

                    Spacer()

                    // Similarity score
                    Text(String(format: "%.0f%%", result.similarity * 100))
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Text(result.excerpt)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .lineLimit(2)

                HStack(spacing: 8) {
                    Label(result.typeDescription, systemImage: result.iconName)
                        .font(.caption)
                        .foregroundColor(.secondary)

                    if let page = result.metadata.pageNumber {
                        Text("• Page \(page)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    if let timestamp = result.timestamp {
                        Text("• \(timestamp.formatted(date: .abbreviated, time: .omitted))")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    if let refCount = result.metadata.referenceCount {
                        Text("• \(refCount) refs")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 12)
        .background(isSelected ? Color.blue.opacity(0.1) : Color.clear)
    }

    private func colorForType(_ type: SearchResult.ResultType) -> Color {
        switch type {
        case .documentChunk: return .blue
        case .chatMessage: return .green
        case .concept: return .purple
        case .note: return .orange
        case .learningGoal: return .pink
        }
    }
}

struct SearchTip: View {
    let icon: String
    let text: String

    var body: some View {
        HStack {
            Image(systemName: icon)
                .foregroundColor(.secondary)
                .frame(width: 20)

            Text(text)
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
    }
}

// MARK: - Command Palette Modifier

struct CommandPaletteModifier: ViewModifier {
    @State private var isShowingPalette = false
    let onNavigate: (SearchResult) -> Void

    func body(content: Content) -> some View {
        content
            .overlay {
                if isShowingPalette {
                    ZStack {
                        Color.black.opacity(0.3)
                            .ignoresSafeArea()
                            .onTapGesture {
                                isShowingPalette = false
                            }

                        CommandPaletteView(onNavigate: onNavigate)
                            .onExitCommand {
                                isShowingPalette = false
                            }
                    }
                }
            }
            .onAppear {
                // Register Cmd+K shortcut
                NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
                    if event.modifierFlags.contains(.command) && event.charactersIgnoringModifiers == "k" {
                        isShowingPalette.toggle()
                        return nil // Consume the event
                    }
                    return event
                }
            }
    }
}

extension View {
    func commandPalette(onNavigate: @escaping (SearchResult) -> Void) -> some View {
        modifier(CommandPaletteModifier(onNavigate: onNavigate))
    }
}

#Preview {
    CommandPaletteView { result in
        print("Navigate to: \(result.title)")
    }
    .environmentObject(OllamaService())
    .modelContainer(for: AetheriumProject.self, inMemory: true)
}
