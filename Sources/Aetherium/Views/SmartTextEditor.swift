import SwiftUI
import SwiftData

// MARK: - Smart Text Editor with Live Linking

struct SmartTextEditor: View {
    @Binding var text: String
    let project: AetheriumProject?
    let placeholder: String

    @Environment(\.modelContext) private var modelContext
    @StateObject private var parser = LinkSyntaxParser()
    @StateObject private var linkingEngine: LinkingEngine

    @State private var showingAutoComplete = false
    @State private var autoCompleteSuggestions: [ConceptNode] = []
    @State private var cursorPosition = 0
    @State private var partialConcept = ""

    @FocusState private var isFocused: Bool

    init(text: Binding<String>, project: AetheriumProject?, placeholder: String = "Start typing...", modelContext: ModelContext) {
        self._text = text
        self.project = project
        self.placeholder = placeholder
        _linkingEngine = StateObject(wrappedValue: LinkingEngine(modelContext: modelContext))
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            // Text editor
            TextEditor(text: $text)
                .font(.body)
                .focused($isFocused)
                .onChange(of: text) { oldValue, newValue in
                    handleTextChange(oldValue: oldValue, newValue: newValue)
                }
                .overlay(alignment: .topLeading) {
                    if text.isEmpty {
                        Text(placeholder)
                            .foregroundColor(.secondary)
                            .padding(.top, 8)
                            .padding(.leading, 5)
                            .allowsHitTesting(false)
                    }
                }

            // Auto-complete overlay
            if showingAutoComplete && !autoCompleteSuggestions.isEmpty {
                VStack {
                    Spacer()
                        .frame(height: calculateAutoCompleteOffset())

                    HStack {
                        Spacer()
                            .frame(width: 20)

                        VStack(alignment: .leading, spacing: 0) {
                            ConceptAutoCompleteView(
                                suggestions: Array(autoCompleteSuggestions.prefix(5)),
                                onSelect: insertConcept
                            )

                            if !autoCompleteSuggestions.contains(where: { $0.name.lowercased() == partialConcept.lowercased() }) && !partialConcept.isEmpty {
                                Divider()

                                CreateConceptSuggestion(
                                    conceptName: partialConcept,
                                    onCreate: createNewConcept
                                )
                                .background(.ultraThinMaterial)
                            }
                        }

                        Spacer()
                    }

                    Spacer()
                }
            }
        }
        .onAppear {
            isFocused = true
        }
    }

    // MARK: - Text Change Handling

    private func handleTextChange(oldValue: String, newValue: String) {
        // Check for partial concept (for autocomplete)
        if let (_, partial) = parser.partialConceptAtCursor(in: newValue, position: cursorPosition) {
            partialConcept = partial
            updateAutoComplete(for: partial)
        } else {
            showingAutoComplete = false
            autoCompleteSuggestions = []
            partialConcept = ""
        }

        // Auto-create links for existing concepts
        if let project = project {
            autoLinkConcepts(in: newValue, project: project)
        }
    }

    private func updateAutoComplete(for partial: String) {
        guard let project = project else {
            showingAutoComplete = false
            return
        }

        // Search for matching concepts
        let allConcepts = project.concepts
        let matches = allConcepts.filter { concept in
            concept.name.lowercased().contains(partial.lowercased())
        }

        if !matches.isEmpty || !partial.isEmpty {
            autoCompleteSuggestions = matches.sorted { lhs, rhs in
                // Prioritize exact prefix matches
                let lhsStarts = lhs.name.lowercased().hasPrefix(partial.lowercased())
                let rhsStarts = rhs.name.lowercased().hasPrefix(partial.lowercased())

                if lhsStarts != rhsStarts {
                    return lhsStarts
                }

                // Then by reference count
                return lhs.referenceCount > rhs.referenceCount
            }
            showingAutoComplete = true
        } else {
            showingAutoComplete = false
        }
    }

    // MARK: - Concept Actions

    private func insertConcept(_ concept: ConceptNode) {
        guard let (range, _) = parser.partialConceptAtCursor(in: text, position: cursorPosition) else {
            return
        }

        // Replace partial text with concept name
        let nsString = text as NSString
        let beforePartial = nsString.substring(to: range.location)
        let afterPartial = nsString.substring(from: range.location + range.length)

        text = beforePartial + concept.name + "]]" + afterPartial

        showingAutoComplete = false
        autoCompleteSuggestions = []
        partialConcept = ""
    }

    private func createNewConcept() {
        guard let project = project, !partialConcept.isEmpty else { return }

        // Create new concept
        let newConcept = ConceptNode(
            name: partialConcept,
            description: nil,
            nodeType: .topic
        )
        newConcept.project = project

        modelContext.insert(newConcept)

        // Insert it into the text
        insertConcept(newConcept)
    }

    private func autoLinkConcepts(in text: String, project: AetheriumProject) {
        // Detect all [[concept]] links
        let conceptNames = parser.extractConceptNames(from: text)

        // Find or create concepts
        for name in conceptNames {
            // Check if concept exists
            let existingConcept = project.concepts.first { $0.name.lowercased() == name.lowercased() }

            if existingConcept == nil {
                // Create concept automatically
                let concept = ConceptNode(
                    name: name,
                    description: nil,
                    nodeType: .topic
                )
                concept.project = project
                modelContext.insert(concept)
            }
        }
    }

    // MARK: - UI Helpers

    private func calculateAutoCompleteOffset() -> CGFloat {
        // Estimate cursor position in text editor
        // This is a simplified version - in production you'd want more accurate cursor tracking
        let lines = text.components(separatedBy: .newlines)
        let lineHeight: CGFloat = 20

        return CGFloat(lines.count.min(10)) * lineHeight
    }
}

// MARK: - Syntax Highlighted Text View (Alternative)

struct SyntaxHighlightedTextView: View {
    @Binding var text: String
    let placeholder: String

    @StateObject private var parser = LinkSyntaxParser()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if text.isEmpty {
                Text(placeholder)
                    .foregroundColor(.secondary)
            } else {
                Text(parser.applySyntaxHighlighting(to: text))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(8)
        .background(Color.secondary.opacity(0.05))
        .cornerRadius(8)
    }
}

// MARK: - Quick Link Insertion

struct QuickLinkButton: View {
    let onInsert: (String) -> Void

    @State private var showingPicker = false

    var body: some View {
        Button(action: { showingPicker = true }) {
            Label("Insert Link", systemImage: "link.badge.plus")
                .font(.caption)
        }
        .buttonStyle(.bordered)
        .popover(isPresented: $showingPicker) {
            QuickLinkPicker(onSelect: { conceptName in
                onInsert("[[\(conceptName)]]")
                showingPicker = false
            })
        }
    }
}

struct QuickLinkPicker: View {
    let onSelect: (String) -> Void

    @Environment(\.modelContext) private var modelContext
    @Query private var concepts: [ConceptNode]

    @State private var searchText = ""

    var filteredConcepts: [ConceptNode] {
        if searchText.isEmpty {
            return Array(concepts.prefix(10))
        }
        return concepts.filter { $0.name.lowercased().contains(searchText.lowercased()) }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Search
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.secondary)
                TextField("Search concepts...", text: $searchText)
                    .textFieldStyle(.plain)
            }
            .padding(12)
            .background(Color.secondary.opacity(0.1))

            Divider()

            // Results
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(filteredConcepts) { concept in
                        Button(action: { onSelect(concept.name) }) {
                            HStack {
                                Text(concept.name)
                                    .font(.body)

                                Spacer()

                                if let desc = concept.conceptDescription {
                                    Text(desc)
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                        .lineLimit(1)
                                }
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                        }
                        .buttonStyle(.plain)

                        Divider()
                    }
                }
            }
        }
        .frame(width: 400, height: 300)
    }
}

#Preview {
    @State var text = """
    # My Notes

    This is about [[SwiftUI]] and [[Combine]].

    Some more thoughts on [[
    """

    let config = ModelConfiguration(isStoredInMemoryOnly: true)
    let container = try! ModelContainer(for: AetheriumProject.self, configurations: config)

    let project = AetheriumProject(title: "Test", description: "Test")

    let concept1 = ConceptNode(name: "SwiftUI", description: "Declarative UI", nodeType: .technology)
    let concept2 = ConceptNode(name: "Combine", description: "Reactive framework", nodeType: .technology)
    let concept3 = ConceptNode(name: "Swift Concurrency", description: "Async/await", nodeType: .technology)

    concept1.project = project
    concept2.project = project
    concept3.project = project

    container.mainContext.insert(project)
    container.mainContext.insert(concept1)
    container.mainContext.insert(concept2)
    container.mainContext.insert(concept3)

    return SmartTextEditor(
        text: $text,
        project: project,
        placeholder: "Start typing...",
        modelContext: container.mainContext
    )
    .frame(width: 600, height: 400)
    .padding()
    .modelContainer(container)
}
