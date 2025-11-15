import SwiftUI
import SwiftData
import UniformTypeIdentifiers

struct DocumentBrowserView: View {
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject var ollamaService: OllamaService
    @ObservedObject var project: AetheriumProject

    @StateObject private var documentProcessor: DocumentProcessor
    @State private var searchText = ""
    @State private var showingImportSheet = false
    @State private var selectedSource: ProjectSource?
    @State private var isImporting = false

    init(project: AetheriumProject, ollamaService: OllamaService) {
        self.project = project
        _documentProcessor = StateObject(wrappedValue: DocumentProcessor(ollamaService: ollamaService))
    }

    var filteredSources: [ProjectSource] {
        if searchText.isEmpty {
            return project.sources
        }
        return project.sources.filter { source in
            source.title.localizedCaseInsensitiveContains(searchText)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Search bar
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.secondary)
                TextField("Search sources...", text: $searchText)
                    .textFieldStyle(.plain)
                if !searchText.isEmpty {
                    Button(action: { searchText = "" }) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(12)
            .background(Color.secondary.opacity(0.1))
            .cornerRadius(8)
            .padding()

            // Source statistics
            if !project.sources.isEmpty {
                HStack(spacing: 20) {
                    StatBadge(
                        icon: "doc.text",
                        count: project.sources.filter { $0.type == .document }.count,
                        label: "Documents"
                    )
                    StatBadge(
                        icon: "globe",
                        count: project.sources.filter { $0.type == .webpage }.count,
                        label: "Webpages"
                    )
                    StatBadge(
                        icon: "mic",
                        count: project.sources.filter { $0.type == .audioTranscription }.count,
                        label: "Audio"
                    )
                    StatBadge(
                        icon: "note.text",
                        count: project.sources.filter { $0.type == .note }.count,
                        label: "Notes"
                    )
                }
                .padding()
                .background(Color.blue.opacity(0.05))
            }

            Divider()

            // Source list
            if filteredSources.isEmpty {
                ContentUnavailableView(
                    "No Sources",
                    systemImage: "doc.questionmark",
                    description: Text("Add documents, webpages, or notes to ground your AI conversations in source material")
                )
            } else {
                List(filteredSources, selection: $selectedSource) { source in
                    SourceRow(source: source)
                        .contextMenu {
                            Button("View Details") {
                                selectedSource = source
                            }

                            if source.type == .document {
                                Button("Extract Key Points") {
                                    extractKeyPoints(from: source)
                                }
                            }

                            Divider()

                            Button("Delete", role: .destructive) {
                                deleteSource(source)
                            }
                        }
                }
            }

            Divider()

            // Import controls
            HStack(spacing: 12) {
                Button(action: { showingImportSheet = true }) {
                    Label("Import Document", systemImage: "doc.badge.plus")
                }
                .buttonStyle(.borderedProminent)

                Menu {
                    Button(action: captureWebpage) {
                        Label("Capture Webpage", systemImage: "globe")
                    }

                    Button(action: createNote) {
                        Label("Create Note", systemImage: "note.text.badge.plus")
                    }

                    Button(action: { /* TODO */ }) {
                        Label("Record Audio", systemImage: "mic")
                    }
                } label: {
                    Image(systemName: "plus.circle")
                        .font(.title2)
                }
                .buttonStyle(.plain)
            }
            .padding()
            .background(.background)
        }
        .navigationTitle("Sources")
        .fileImporter(
            isPresented: $showingImportSheet,
            allowedContentTypes: [.pdf, .plainText, .html, .rtf],
            allowsMultipleSelection: true
        ) { result in
            handleFileImport(result)
        }
        .overlay {
            if documentProcessor.isProcessing {
                ProcessingOverlay(progress: documentProcessor.processingProgress)
            }
        }
    }

    // MARK: - Actions

    private func handleFileImport(_ result: Result<[URL], Error>) {
        guard case .success(let urls) = result else { return }

        Task {
            do {
                for url in urls {
                    // Ensure we can access the file
                    guard url.startAccessingSecurityScopedResource() else { continue }
                    defer { url.stopAccessingSecurityScopedResource() }

                    // Process document
                    let document = try await documentProcessor.processDocument(url)

                    // Create source
                    let source = ProjectSource(
                        sourceType: .document,
                        title: document.filename
                    )
                    source.document = document
                    source.project = project
                    source.processedAt = Date()

                    modelContext.insert(source)
                    project.updateTimestamp()
                }
            } catch {
                print("Error importing documents: \(error)")
            }
        }
    }

    private func deleteSource(_ source: ProjectSource) {
        modelContext.delete(source)
        project.updateTimestamp()
    }

    private func extractKeyPoints(from source: ProjectSource) {
        // TODO: Implement key point extraction
        print("Extract key points from: \(source.title)")
    }

    private func captureWebpage() {
        // TODO: Show webpage capture sheet
        print("Capture webpage")
    }

    private func createNote() {
        let note = ProjectNote(
            title: "New Note",
            content: "",
            noteType: .manual
        )

        let source = ProjectSource(
            sourceType: .note,
            title: note.title
        )
        source.note = note
        source.project = project

        modelContext.insert(source)
        selectedSource = source
        project.updateTimestamp()
    }
}

// MARK: - Supporting Views

struct SourceRow: View {
    let source: ProjectSource

    var body: some View {
        HStack(spacing: 12) {
            // Icon
            Image(systemName: iconForSourceType(source.type))
                .font(.title2)
                .foregroundColor(colorForSourceType(source.type))
                .frame(width: 40, height: 40)
                .background(colorForSourceType(source.type).opacity(0.1))
                .cornerRadius(8)

            VStack(alignment: .leading, spacing: 4) {
                Text(source.title)
                    .font(.headline)
                    .lineLimit(1)

                HStack(spacing: 8) {
                    Text(source.type.rawValue.capitalized)
                        .font(.caption)
                        .foregroundColor(.secondary)

                    if let processed = source.processedAt {
                        Text("•")
                            .foregroundColor(.secondary)
                        Text(processed.formatted(date: .abbreviated, time: .omitted))
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                if source.type == .document, let doc = source.document {
                    Text("\(doc.chunks.count) chunks • \(ByteCountFormatter.string(fromByteCount: doc.fileSize, countStyle: .file))")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            if source.isProcessing {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .padding(.vertical, 4)
    }

    private func iconForSourceType(_ type: ProjectSourceType) -> String {
        switch type {
        case .document: return "doc.text.fill"
        case .webpage: return "globe"
        case .audioTranscription: return "mic.fill"
        case .note: return "note.text"
        }
    }

    private func colorForSourceType(_ type: ProjectSourceType) -> Color {
        switch type {
        case .document: return .blue
        case .webpage: return .green
        case .audioTranscription: return .orange
        case .note: return .purple
        }
    }
}

struct StatBadge: View {
    let icon: String
    let count: Int
    let label: String

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                Text("\(count)")
                    .fontWeight(.semibold)
            }
            .font(.title3)

            Text(label)
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

struct ProcessingOverlay: View {
    let progress: Double

    var body: some View {
        ZStack {
            Color.black.opacity(0.3)

            VStack(spacing: 20) {
                ProgressView(value: progress)
                    .frame(width: 200)

                Text("Processing document...")
                    .font(.headline)

                Text("\(Int(progress * 100))%")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding(30)
            .background(.ultraThinMaterial)
            .cornerRadius(16)
        }
        .ignoresSafeArea()
    }
}

#Preview {
    let config = ModelConfiguration(isStoredInMemoryOnly: true)
    let container = try! ModelContainer(
        for: AetheriumProject.self,
        configurations: config
    )

    let project = AetheriumProject(title: "Test Project", description: "Test")
    container.mainContext.insert(project)

    let ollamaService = OllamaService()

    return DocumentBrowserView(project: project, ollamaService: ollamaService)
        .environmentObject(ollamaService)
        .modelContainer(container)
}
