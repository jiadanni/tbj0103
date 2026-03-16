import SwiftUI
import SwiftData
import UniformTypeIdentifiers

struct DocumentBrowserView: View {
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject var ollamaService: OllamaService
    let project: Workspace
    
    @StateObject private var documentProcessor: DocumentProcessor
    @State private var searchText = ""
    @State private var showingImportSheet = false
    @State private var selectedSource: ProjectSource?
    @State private var isImporting = false
    @State private var extractedKeyPoints: [String] = []
    @State private var showingKeyPoints = false
    @State private var isExtractingKeyPoints = false
    @State private var showingWebCaptureSheet = false
    @State private var showingAudioRecorder = false

    init(project: Workspace, ollamaService: OllamaService) {
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

                    Button(action: { showingAudioRecorder = true }) {
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
            } else if isExtractingKeyPoints {
                OperationOverlay(
                    title: "Extracting Key Points",
                    subtitle: "Analyzing document content...",
                    icon: "sparkles"
                )
            }
        }
        .sheet(isPresented: $showingKeyPoints) {
            KeyPointsSheet(keyPoints: extractedKeyPoints)
        }
        .sheet(isPresented: $showingWebCaptureSheet) {
            WebCaptureSheet(project: project)
        }
        .sheet(isPresented: $showingAudioRecorder) {
            AudioRecordSheet(project: project)
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

                    if let summaryEntity = document.decodedMetadata?.extractedEntities.first(where: { $0.hasPrefix("summary: ") }) {
                        let prefixCount = "summary: ".count
                        let summaryText = String(summaryEntity.dropFirst(prefixCount))
                        let summaryNote = ProjectNote(
                            title: "Summary: \(document.filename)",
                            content: summaryText,
                            noteType: .aiGenerated,
                            tags: ["summary", "auto-generated"]
                        )
                        let noteSource = ProjectSource(
                            sourceType: .note,
                            title: summaryNote.title
                        )
                        noteSource.note = summaryNote
                        noteSource.project = project
                        noteSource.processedAt = Date()

                        modelContext.insert(summaryNote)
                        modelContext.insert(noteSource)
                    }

                    project.updateTimestamp()

                    // Auto-generate flashcards and knowledge graph concepts
                    let autoGen = AutoContentGenerator(ollamaService: ollamaService, modelContext: modelContext)
                    Task { await autoGen.processDocument(document, project: project) }
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
        guard let text = source.document?.extractedText, !text.isEmpty else { return }
        isExtractingKeyPoints = true
        Task {
            do {
                let generator = AIContentGenerator(ollamaService: ollamaService, modelContext: modelContext)
                let points = try await generator.extractKeyPoints(from: text, count: 5)
                extractedKeyPoints = points
                showingKeyPoints = true
            } catch {
                print("Key point extraction failed: \(error)")
            }
            isExtractingKeyPoints = false
        }
    }

    private func captureWebpage() {
        showingWebCaptureSheet = true
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

    private var phaseLabel: String {
        switch progress {
        case 0..<0.25: return "Extracting text..."
        case 0.25..<0.50: return "Chunking document..."
        case 0.50..<0.75: return "Generating embeddings..."
        case 0.75..<1.0: return "Building document model..."
        default: return "Finishing up..."
        }
    }

    private var phaseIcon: String {
        switch progress {
        case 0..<0.25: return "doc.text.magnifyingglass"
        case 0.25..<0.50: return "scissors"
        case 0.50..<0.75: return "brain.head.profile"
        case 0.75..<1.0: return "doc.badge.gearshape"
        default: return "checkmark.circle"
        }
    }

    var body: some View {
        ZStack {
            Color.black.opacity(0.3)

            VStack(spacing: 16) {
                Image(systemName: phaseIcon)
                    .font(.system(size: 32))
                    .foregroundColor(.blue)
                    .symbolEffect(.pulse, isActive: progress < 1.0)

                Text("Processing Document")
                    .font(.headline)

                ProgressView(value: progress)
                    .frame(width: 220)

                Text(phaseLabel)
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                Text("\(Int(progress * 100))%")
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundColor(.secondary)
            }
            .padding(30)
            .background(.ultraThinMaterial)
            .cornerRadius(16)
        }
        .ignoresSafeArea()
    }
}

// MARK: - Operation Overlay (indeterminate spinner)

struct OperationOverlay: View {
    let title: String
    let subtitle: String
    let icon: String
    var progress: Double? = nil

    var body: some View {
        ZStack {
            Color.black.opacity(0.3)

            VStack(spacing: 16) {
                Image(systemName: icon)
                    .font(.system(size: 32))
                    .foregroundColor(.blue)
                    .symbolEffect(.pulse)

                Text(title)
                    .font(.headline)

                if let progress {
                    ProgressView(value: progress)
                        .frame(width: 220)
                    Text("\(Int(progress * 100))%")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.secondary)
                } else {
                    ProgressView()
                        .controlSize(.regular)
                }

                Text(subtitle)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            .padding(30)
            .background(.ultraThinMaterial)
            .cornerRadius(16)
        }
        .ignoresSafeArea()
    }
}

// MARK: - Key Points Sheet

struct KeyPointsSheet: View {
    let keyPoints: [String]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Key Points")
                .font(.headline)

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(Array(keyPoints.enumerated()), id: \.offset) { index, point in
                        HStack(alignment: .top, spacing: 8) {
                            Text("\(index + 1).")
                                .fontWeight(.bold)
                                .foregroundColor(.blue)
                            Text(point)
                        }
                    }
                }
            }
            .frame(maxHeight: 400)

            HStack {
                Spacer()
                Button("Done") { dismiss() }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 500, height: 400)
    }
}

// MARK: - Web Capture Sheet

struct WebCaptureSheet: View {
    let project: Workspace
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var urlString = ""
    @State private var isCapturing = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 20) {
            Text("Capture Webpage")
                .font(.headline)

            TextField("https://example.com", text: $urlString)
                .textFieldStyle(.roundedBorder)

            if let error = errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
            }

            if isCapturing {
                ProgressView("Fetching page...")
            }

            HStack {
                Button("Cancel") { dismiss() }
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.cancelAction)

                Button("Capture") { captureURL() }
                    .buttonStyle(.borderedProminent)
                    .disabled(urlString.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isCapturing)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 450)
    }

    private func captureURL() {
        let trimmed = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), url.scheme == "https" || url.scheme == "http" else {
            errorMessage = "Please enter a valid HTTP or HTTPS URL."
            return
        }

        isCapturing = true
        errorMessage = nil

        Task {
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                let html = String(data: data, encoding: .utf8) ?? ""

                // Extract title from HTML
                let pageTitle: String
                if let titleRange = html.range(of: "<title>"),
                   let endRange = html.range(of: "</title>", range: titleRange.upperBound..<html.endIndex) {
                    pageTitle = String(html[titleRange.upperBound..<endRange.lowerBound])
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                } else {
                    pageTitle = url.host ?? "Captured Page"
                }

                // Strip HTML tags for plain-text content
                let plainText = html.replacingOccurrences(
                    of: "<[^>]+>",
                    with: "",
                    options: .regularExpression
                ).trimmingCharacters(in: .whitespacesAndNewlines)

                let webCapture = WebCapture(
                    url: trimmed,
                    pageTitle: pageTitle,
                    extractedContent: String(plainText.prefix(50000))
                )

                let source = ProjectSource(sourceType: .webpage, title: pageTitle)
                source.webpage = webCapture
                source.project = project
                source.processedAt = Date()

                modelContext.insert(source)
                project.updateTimestamp()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            isCapturing = false
        }
    }
}

// MARK: - Audio Record Sheet

struct AudioRecordSheet: View {
    let project: Workspace
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var isRecording = false
    @State private var transcribedText = ""
    @State private var errorMessage: String?
    @State private var recordingDuration: TimeInterval = 0
    @StateObject private var voiceService = VoiceTranscriptionService()

    var body: some View {
        VStack(spacing: 20) {
            Text("Record Audio")
                .font(.headline)

            if !transcribedText.isEmpty {
                ScrollView {
                    Text(transcribedText)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(height: 150)
                .padding(8)
                .background(Color.secondary.opacity(0.1))
                .cornerRadius(8)
            } else {
                VStack(spacing: 12) {
                    Image(systemName: isRecording ? "mic.fill" : "mic")
                        .font(.system(size: 48))
                        .foregroundColor(isRecording ? .red : .secondary)

                    if isRecording {
                        Text("Recording...")
                            .foregroundColor(.red)
                    } else {
                        Text("Tap to start recording")
                            .foregroundColor(.secondary)
                    }
                }
                .frame(height: 150)
            }

            if let error = errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
            }

            HStack {
                Button("Cancel") { dismiss() }
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.cancelAction)

                if transcribedText.isEmpty {
                    Button(isRecording ? "Stop" : "Record") {
                        toggleRecording()
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(isRecording ? .red : .blue)
                } else {
                    Button("Save Transcription") {
                        saveTranscription()
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
        }
        .padding(24)
        .frame(width: 450)
        .onChange(of: voiceService.transcribedText) { _, newValue in
            transcribedText = newValue
        }
    }

    private func toggleRecording() {
        if isRecording {
            voiceService.stopRecording()
            isRecording = false
        } else {
            do {
                try voiceService.startRecording()
                isRecording = true
                errorMessage = nil
            } catch {
                errorMessage = "Could not start recording: \(error.localizedDescription)"
            }
        }
    }

    private func saveTranscription() {
        guard !transcribedText.isEmpty else { return }

        let transcription = AudioTranscription(
            filename: "Recording \(Date().formatted(date: .abbreviated, time: .shortened))",
            filePath: "",
            transcription: transcribedText,
            duration: recordingDuration,
            modelUsed: "apple-speech"
        )

        let source = ProjectSource(sourceType: .audioTranscription, title: transcription.filename)
        source.audioFile = transcription
        source.project = project
        source.processedAt = Date()

        modelContext.insert(source)
        project.updateTimestamp()
        dismiss()
    }
}


