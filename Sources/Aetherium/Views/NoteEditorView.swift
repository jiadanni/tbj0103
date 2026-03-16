import SwiftUI
import SwiftData

// MARK: - Note Editor with Live/Preview Modes

struct NoteEditorView: View {
    @Bindable var note: ProjectNote
    let project: Workspace?

    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject var themeManager: ThemeManager
    @StateObject private var linkingEngine: LinkingEngine

    @State private var editMode: EditMode = .live
    @State private var lastSavedText: String
    @State private var autoSaveTimer: Timer?
    @State private var showingSaveIndicator = false
    @State private var isSaving = false

    init(note: ProjectNote, project: Workspace?, modelContext: ModelContext) {
        self.note = note
        self.project = project
        _lastSavedText = State(initialValue: note.content)
        _linkingEngine = StateObject(wrappedValue: LinkingEngine(modelContext: modelContext))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Toolbar
            EditorToolbar(
                editMode: $editMode,
                hasUnsavedChanges: note.content != lastSavedText,
                showingSaveIndicator: showingSaveIndicator,
                onSave: saveNote
            )

            Divider()

            // Editor content
            switch editMode {
            case .live:
                SmartTextEditor(
                    text: $note.content,
                    project: project,
                    placeholder: "Start writing your note...",
                    modelContext: modelContext
                )
                .environmentObject(themeManager)
                .onChange(of: note.content) { _, _ in
                    scheduleAutoSave()
                }

            case .preview:
                MarkdownPreview(text: note.content, project: project)

            case .split:
                HSplitView {
                    SmartTextEditor(
                        text: $note.content,
                        project: project,
                        placeholder: "Start writing your note...",
                        modelContext: modelContext
                    )
                    .onChange(of: note.content) { _, _ in
                        scheduleAutoSave()
                    }

                    MarkdownPreview(text: note.content, project: project)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            Divider()

            // Footer with stats and backlinks
            EditorFooter(
                note: note,
                project: project,
                modelContext: modelContext
            )
        }
        .onAppear {
            startAutoSave()
        }
        .onDisappear {
            stopAutoSave()
            saveNote()
        }
    }

    // MARK: - Auto-Save

    /// Debounced save: resets a 2-second timer on each edit.
    /// This serves as both the debounce and the periodic save mechanism.
    private func scheduleAutoSave() {
        autoSaveTimer?.invalidate()

        autoSaveTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: false) { _ in
            Task { @MainActor in
                saveNote()
            }
        }
    }

    private func startAutoSave() {
        // The debounced scheduleAutoSave() called on each edit handles saving.
        // No separate periodic timer needed — it would race with the debounce timer.
    }

    private func stopAutoSave() {
        autoSaveTimer?.invalidate()
        autoSaveTimer = nil
    }

    private func saveNote() {
        guard note.content != lastSavedText, !isSaving else { return }
        isSaving = true

        // Update note
        note.updatedAt = Date()
        lastSavedText = note.content

        // Process concept links
        if let project = project {
            Task {
                await linkingEngine.processConceptLinks(in: note.content, project: project)
            }
        }

        // Show save indicator
        showingSaveIndicator = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            showingSaveIndicator = false
            isSaving = false
        }
    }

    enum EditMode {
        case live
        case preview
        case split
    }
}

// MARK: - Editor Toolbar

struct EditorToolbar: View {
    @Binding var editMode: NoteEditorView.EditMode
    let hasUnsavedChanges: Bool
    let showingSaveIndicator: Bool
    let onSave: () -> Void

    var body: some View {
        HStack(spacing: 16) {
            // Mode selector
            Picker("Mode", selection: $editMode) {
                Label("Edit", systemImage: "pencil").tag(NoteEditorView.EditMode.live)
                Label("Preview", systemImage: "eye").tag(NoteEditorView.EditMode.preview)
                Label("Split", systemImage: "rectangle.split.2x1").tag(NoteEditorView.EditMode.split)
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 300)

            Spacer()

            // Save indicator
            if showingSaveIndicator {
                HStack(spacing: 4) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                    Text("Saved")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .transition(.opacity)
            } else if hasUnsavedChanges {
                HStack(spacing: 4) {
                    Circle()
                        .fill(Color.orange)
                        .frame(width: 6, height: 6)
                    Text("Unsaved changes")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            // Manual save button
            Button(action: onSave) {
                Label("Save", systemImage: "square.and.arrow.down")
                    .font(.caption)
            }
            .buttonStyle(.bordered)
            .keyboardShortcut("s", modifiers: .command)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(Color.secondary.opacity(0.05))
    }
}

// MARK: - Editor Footer

struct EditorFooter: View {
    let note: ProjectNote
    let project: Workspace?
    let modelContext: ModelContext

    @StateObject private var parser = LinkSyntaxParser()
    @State private var showingBacklinks = false

    var detectedLinks: [String] {
        parser.extractConceptNames(from: note.content)
    }

    var wordCount: Int {
        note.content.components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .count
    }

    var body: some View {
        HStack(spacing: 20) {
            // Stats
            HStack(spacing: 16) {
                Label("\(wordCount) words", systemImage: "text.word.spacing")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Label("\(note.content.count) chars", systemImage: "character")
                    .font(.caption)
                    .foregroundColor(.secondary)

                if !detectedLinks.isEmpty {
                    Label("\(detectedLinks.count) links", systemImage: "link")
                        .font(.caption)
                        .foregroundColor(.blue)
                }
            }

            Spacer()

            // Last modified
            Text("Modified \(note.updatedAt.formatted(.relative(presentation: .named)))")
                .font(.caption)
                .foregroundColor(.secondary)

            // Backlinks button
            if let project = project {
                Button(action: { showingBacklinks.toggle() }) {
                    Label("Backlinks", systemImage: "arrow.triangle.merge")
                        .font(.caption)
                }
                .buttonStyle(.bordered)
                .popover(isPresented: $showingBacklinks) {
                    NoteBacklinksView(note: note, project: project, modelContext: modelContext)
                }
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(Color.secondary.opacity(0.05))
    }
}

// MARK: - Note Backlinks View

struct NoteBacklinksView: View {
    let note: ProjectNote
    let project: Workspace
    let modelContext: ModelContext

    @StateObject private var linkingEngine: LinkingEngine
    @StateObject private var parser = LinkSyntaxParser()

    init(note: ProjectNote, project: Workspace, modelContext: ModelContext) {
        self.note = note
        self.project = project
        self.modelContext = modelContext
        _linkingEngine = StateObject(wrappedValue: LinkingEngine(modelContext: modelContext))
    }

    var referencedConcepts: [ConceptNode] {
        let conceptNames = parser.extractConceptNames(from: note.content)
        return project.concepts.filter { concept in
            conceptNames.contains(where: { $0.lowercased() == concept.name.lowercased() })
        }
    }

    var backlinkingNotes: [ProjectNote] {
        guard !note.title.isEmpty else { return [] }
        return project.sources.compactMap(\.note).filter {
            $0.id != note.id && $0.content.localizedCaseInsensitiveContains(note.title)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Referenced Concepts")
                .font(.headline)
                .padding(.bottom, 4)

            if referencedConcepts.isEmpty {
                Text("No concept links in this note")
                    .font(.caption)
                    .foregroundColor(.secondary)
            } else {
                ForEach(referencedConcepts) { concept in
                    ConceptBacklinkCard(concept: concept, modelContext: modelContext)
                }
            }

            Divider()

            Text("Notes that reference this note")
                .font(.headline)
                .padding(.bottom, 4)

            if backlinkingNotes.isEmpty {
                Text("No notes reference this note")
                    .font(.caption)
                    .foregroundColor(.secondary)
            } else {
                ForEach(backlinkingNotes) { backlink in
                    BacklinkNoteCard(note: backlink)
                }
            }
        }
        .padding()
        .frame(width: 350)
    }
}

struct BacklinkNoteCard: View {
    let note: ProjectNote

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "note.text")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text(note.title)
                    .font(.callout)
                    .fontWeight(.medium)
                    .lineLimit(1)
            }
            Text(note.updatedAt.formatted(.relative(presentation: .named)))
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.05))
        .cornerRadius(8)
    }
}

struct ConceptBacklinkCard: View {
    let concept: ConceptNode
    let modelContext: ModelContext

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: iconForType(concept.type))
                    .foregroundColor(colorForType(concept.type))

                Text(concept.name)
                    .font(.callout)
                    .fontWeight(.medium)

                Spacer()

                Text("\(concept.referenceCount)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            if let description = concept.conceptDescription {
                Text(description)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
            }

            if !concept.linkedConcepts.isEmpty {
                HStack(spacing: 4) {
                    Image(systemName: "link")
                        .font(.caption2)
                        .foregroundColor(.secondary)

                    ForEach(concept.linkedConcepts.prefix(3)) { linked in
                        Text(linked.name)
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.blue.opacity(0.1))
                            .cornerRadius(4)
                    }
                }
            }
        }
        .padding(10)
        .background(Color.secondary.opacity(0.05))
        .cornerRadius(8)
    }

    private func iconForType(_ type: ConceptNodeType) -> String {
        switch type {
        case .topic: return "book.fill"
        case .person: return "person.fill"
        case .technology: return "cpu"
        case .definition: return "text.book.closed.fill"
        case .question: return "questionmark.circle.fill"
        case .insight: return "lightbulb.fill"
        case .resource: return "link.circle.fill"
        case .custom: return "star.fill"
        }
    }

    private func colorForType(_ type: ConceptNodeType) -> Color {
        switch type {
        case .topic: return .blue
        case .person: return .purple
        case .technology: return .green
        case .definition: return .orange
        case .question: return .red
        case .insight: return .yellow
        case .resource: return .cyan
        case .custom: return .gray
        }
    }
}


