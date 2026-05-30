import SwiftData
import SwiftUI

// MARK: - WorkspaceGlossaryView
// Browse and manage per-workspace glossary terms.
// Mirrors Tauri WorkspaceSettingsView (TopicsSection) + glossary commands.

struct WorkspaceGlossaryView: View {
    let workspace: Workspace
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject private var ollamaService: OllamaService

    @Query private var allTerms: [WorkspaceGlossaryTerm]

    @State private var searchText = ""
    @State private var showingNewTerm = false
    @State private var termToEdit: WorkspaceGlossaryTerm?
    @State private var isSeedingFromAI = false

    init(workspace: Workspace) {
        self.workspace = workspace
        let workspaceId = workspace.id
        _allTerms = Query(
            filter: #Predicate<WorkspaceGlossaryTerm> { $0.workspace?.id == workspaceId },
            sort: [SortDescriptor(\WorkspaceGlossaryTerm.term)]
        )
    }

    private var filteredTerms: [WorkspaceGlossaryTerm] {
        guard !searchText.isEmpty else { return allTerms }
        let q = searchText.lowercased()
        return allTerms.filter {
            $0.term.lowercased().contains(q) ||
            $0.definition.lowercased().contains(q) ||
            $0.aliases.contains { $0.lowercased().contains(q) }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Image(systemName: "text.book.closed.fill").foregroundColor(.accentColor)
                Text("Glossary").font(.headline)
                Spacer()
                Button {
                    Task { await seedFromAI() }
                } label: {
                    Label(isSeedingFromAI ? "Seeding…" : "Seed from AI", systemImage: "sparkles")
                }
                .font(.caption)
                .disabled(isSeedingFromAI)

                Button(action: { showingNewTerm = true }) {
                    Label("Add Term", systemImage: "plus")
                }
                .font(.caption)
            }
            .padding()

            Divider()

            // Search bar
            HStack {
                Image(systemName: "magnifyingglass").foregroundColor(.secondary)
                TextField("Search terms…", text: $searchText)
                    .textFieldStyle(.plain)
                if !searchText.isEmpty {
                    Button(action: { searchText = "" }) {
                        Image(systemName: "xmark.circle.fill").foregroundColor(.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)

            Divider()

            if filteredTerms.isEmpty {
                ContentUnavailableView(
                    searchText.isEmpty ? "No Glossary Terms" : "No Results",
                    systemImage: searchText.isEmpty ? "text.book.closed" : "magnifyingglass",
                    description: Text(searchText.isEmpty
                        ? "Add domain-specific terms to help the AI understand your workspace vocabulary."
                        : "No terms match '\(searchText)'.")
                )
            } else {
                List {
                    ForEach(filteredTerms) { term in
                        GlossaryTermRow(term: term)
                            .contentShape(Rectangle())
                            .onTapGesture { termToEdit = term }
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    deleteTerm(term)
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                    }
                }
                .listStyle(.plain)
            }

            // Footer counts
            HStack {
                Text("\(allTerms.count) term(s)")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                Spacer()
                Text("\(allTerms.filter(\.isManual).count) manual · \(allTerms.filter { !$0.isManual }.count) AI-seeded")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal)
            .padding(.vertical, 6)
        }
        .sheet(isPresented: $showingNewTerm) {
            GlossaryTermSheet(workspace: workspace)
        }
        .sheet(item: $termToEdit) { term in
            GlossaryTermSheet(workspace: workspace, editing: term)
        }
    }

    private func deleteTerm(_ term: WorkspaceGlossaryTerm) {
        modelContext.delete(term)
        try? modelContext.save()
    }

    private func seedFromAI() async {
        isSeedingFromAI = true
        defer { isSeedingFromAI = false }

        // Build a prompt from recent concept names + chat titles
        let conceptSample = workspace.concepts
            .prefix(20)
            .map(\.name)
            .joined(separator: ", ")

        let prompt = """
        You are a terminology extractor. Given the following topic words from a workspace titled "\(workspace.title)", output a JSON array of objects with "term" and "definition" keys.
        
        Topics: \(conceptSample)
        
        Output ONLY valid JSON, no commentary. Example:
        [{"term":"Transformer","definition":"A neural network architecture using self-attention."}]
        """

        do {
            let raw = try await ollamaService.generateText(prompt: prompt)
            // Extract JSON array from response
            if let start = raw.firstIndex(of: "["),
               let end = raw.lastIndex(of: "]") {
                let jsonSlice = String(raw[start...end])
                if let data = jsonSlice.data(using: .utf8),
                   let parsed = try? JSONDecoder().decode([[String: String]].self, from: data) {
                    let existingTerms = Set(allTerms.map { $0.term.lowercased() })
                    for item in parsed {
                        guard let term = item["term"], let definition = item["definition"],
                              !existingTerms.contains(term.lowercased()) else { continue }
                        let entry = WorkspaceGlossaryTerm(
                            term: term,
                            definition: definition,
                            isManual: false,
                            workspace: workspace
                        )
                        modelContext.insert(entry)
                    }
                    try? modelContext.save()
                }
            }
        } catch {
            // Silently fail; user can retry manually
        }
    }
}

// MARK: - GlossaryTermRow

private struct GlossaryTermRow: View {
    let term: WorkspaceGlossaryTerm

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(term.term)
                    .font(.body.bold())
                if !term.isManual {
                    Image(systemName: "sparkles")
                        .font(.caption2)
                        .foregroundColor(.orange)
                }
                if !term.aliases.isEmpty {
                    Text(term.aliases.prefix(3).joined(separator: " · "))
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .italic()
                }
            }

            Text(term.definition)
                .font(.caption)
                .foregroundColor(.secondary)
                .lineLimit(2)
        }
        .padding(.vertical, 2)
    }
}

// MARK: - GlossaryTermSheet

struct GlossaryTermSheet: View {
    let workspace: Workspace
    var editing: WorkspaceGlossaryTerm? = nil

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var term = ""
    @State private var definition = ""
    @State private var aliasesText = ""    // comma-separated

    init(workspace: Workspace, editing: WorkspaceGlossaryTerm? = nil) {
        self.workspace = workspace
        self.editing = editing
        _term = State(initialValue: editing?.term ?? "")
        _definition = State(initialValue: editing?.definition ?? "")
        _aliasesText = State(initialValue: editing?.aliases.joined(separator: ", ") ?? "")
    }

    var body: some View {
        VStack(spacing: 20) {
            Text(editing == nil ? "New Glossary Term" : "Edit Glossary Term")
                .font(.headline)

            VStack(alignment: .leading, spacing: 12) {
                TextField("Term", text: $term)
                    .textFieldStyle(.roundedBorder)

                TextField("Definition", text: $definition, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(3...6)

                TextField("Aliases (comma-separated, optional)", text: $aliasesText)
                    .textFieldStyle(.roundedBorder)
            }

            HStack {
                Button("Cancel") { dismiss() }
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.cancelAction)

                Button(editing == nil ? "Create" : "Save") { save() }
                    .buttonStyle(.borderedProminent)
                    .disabled(term.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                              definition.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 440)
    }

    private func save() {
        let aliases = aliasesText
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }

        if let existing = editing {
            existing.term = term
            existing.definition = definition
            existing.aliases = aliases
            existing.updateTimestamp()
        } else {
            let entry = WorkspaceGlossaryTerm(
                term: term,
                definition: definition,
                aliases: aliases,
                isManual: true,
                workspace: workspace
            )
            modelContext.insert(entry)
        }
        try? modelContext.save()
        dismiss()
    }
}
