import SwiftUI
import SwiftData

struct DeduplicationView: View {
    let project: Workspace
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject var ollamaService: OllamaService

    @State private var duplicatePairs: [(ProjectNote, ProjectNote, Double)] = []
    @State private var isScanning = false
    @State private var errorMessage: String?

    var body: some View {
        VStack {
            if isScanning {
                ProgressView("Scanning for duplicates...")
            } else if duplicatePairs.isEmpty {
                ContentUnavailableView(
                    "No Duplicates Found",
                    systemImage: "doc.on.doc",
                    description: Text("Your notes look clean and distinct.")
                )
            } else {
                List {
                    ForEach(duplicatePairs.indices, id: \.self) { index in
                        let pair = duplicatePairs[index]
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Text("\(Int(pair.2 * 100))% Match")
                                    .font(.headline)
                                    .foregroundColor(.orange)
                                Spacer()
                                Button("Merge Notes") {
                                    mergeNotes(index: index)
                                }
                                .buttonStyle(.bordered)
                            }

                            HStack(alignment: .top, spacing: 16) {
                                VStack(alignment: .leading) {
                                    Text("Note A: \(pair.0.title)")
                                        .font(.subheadline).bold()
                                    Text(pair.0.content)
                                        .font(.caption)
                                        .lineLimit(4)
                                        .foregroundColor(.secondary)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)

                                Divider()

                                VStack(alignment: .leading) {
                                    Text("Note B: \(pair.1.title)")
                                        .font(.subheadline).bold()
                                    Text(pair.1.content)
                                        .font(.caption)
                                        .lineLimit(4)
                                        .foregroundColor(.secondary)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                        .padding(.vertical, 8)
                    }
                }
            }
        }
        .navigationTitle("Find Duplicate Notes")
        .task {
            await scanForDuplicates()
        }
        .alert("Error", isPresented: .constant(errorMessage != nil)) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func scanForDuplicates() async {
        isScanning = true
        defer { isScanning = false }

        let searchEngine = SemanticSearchEngine(ollamaService: ollamaService, modelContext: modelContext)
        do {
            let results = try await searchEngine.findDuplicateNotes(in: project)
            duplicatePairs = results
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func mergeNotes(index: Int) {
        let pair = duplicatePairs[index]
        let noteA = pair.0
        let noteB = pair.1

        // Append Note B's content to Note A
        noteA.content += "\n\n--- Merged from \(noteB.title) ---\n\n" + noteB.content
        noteA.updatedAt = Date()

        // Delete Note B and its source wrapper
        if let sourceB = noteB.source {
            modelContext.delete(sourceB)
        }
        modelContext.delete(noteB)

        // Remove from list
        duplicatePairs.remove(at: index)

        // Clean up remaining pairs that might reference Note B
        duplicatePairs.removeAll { $0.0.id == noteB.id || $0.1.id == noteB.id }

        try? modelContext.save()
    }
}
