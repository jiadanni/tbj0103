import SwiftData
import SwiftUI

struct BacklinksView: View {
    @Environment(\.modelContext) private var modelContext
    let concept: ConceptNode

    @StateObject private var linkingEngine: LinkingEngine

    init(concept: ConceptNode, modelContext: ModelContext) {
        self.concept = concept
        _linkingEngine = StateObject(wrappedValue: LinkingEngine(modelContext: modelContext))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack {
                Label("Backlinks", systemImage: "arrow.triangle.merge")
                    .font(.headline)

                Spacer()

                Text("\(backlinks.count)")
                    .foregroundColor(.secondary)
            }
            .padding()
            .background(Color.secondary.opacity(0.1))

            Divider()

            // Backlinks list
            if backlinks.isEmpty {
                ContentUnavailableView(
                    "No Backlinks",
                    systemImage: "link.badge.plus",
                    description: Text("This concept hasn't been referenced yet")
                )
            } else {
                List(backlinks) { backlink in
                    BacklinkRow(backlink: backlink)
                }
            }
        }
    }

    private var backlinks: [Backlink] {
        linkingEngine.getBacklinks(for: concept)
    }
}

struct BacklinkRow: View {
    let backlink: Backlink

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Source info
            HStack {
                Image(systemName: iconForSourceType(backlink.sourceType))
                    .foregroundColor(colorForSourceType(backlink.sourceType))

                Text(backlink.displayTitle)
                    .font(.subheadline)
                    .fontWeight(.medium)

                Spacer()

                Text(backlink.createdAt.formatted(date: .abbreviated, time: .omitted))
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            // Context preview
            Text(backlink.context)
                .font(.caption)
                .foregroundColor(.secondary)
                .lineLimit(3)
                .padding(8)
                .background(Color.secondary.opacity(0.05))
                .cornerRadius(6)
        }
        .padding(.vertical, 4)
    }

    private func iconForSourceType(_ type: MentionSourceType) -> String {
        switch type {
        case .message: return "message"
        case .note: return "note.text"
        case .documentChunk: return "doc.text"
        case .learningGoal: return "target"
        }
    }

    private func colorForSourceType(_ type: MentionSourceType) -> Color {
        switch type {
        case .message: return .blue
        case .note: return .purple
        case .documentChunk: return .orange
        case .learningGoal: return .green
        }
    }
}

// MARK: - Inline Backlinks Panel (for Notes/Chats)

struct InlineBacklinksPanel: View {
    @Environment(\.modelContext) private var modelContext
    let text: String
    let project: Workspace

    @StateObject private var linkingEngine: LinkingEngine
    @State private var detectedConcepts: [ConceptNode] = []

    init(text: String, project: Workspace, modelContext: ModelContext) {
        self.text = text
        self.project = project
        _linkingEngine = StateObject(wrappedValue: LinkingEngine(modelContext: modelContext))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !detectedConcepts.isEmpty {
                Text("Related Concepts")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundColor(.secondary)

                ForEach(detectedConcepts.prefix(5)) { concept in
                    ConceptChip(concept: concept)
                }
            }
        }
        .task {
            await loadDetectedConcepts()
        }
        .onChange(of: text) { _, _ in
            Task {
                await loadDetectedConcepts()
            }
        }
    }

    private func loadDetectedConcepts() async {
        let detected = await linkingEngine.detectPotentialConcepts(in: text, project: project)
        detectedConcepts = Array(Set(detected.map { $0.concept }))
    }
}

struct ConceptChip: View {
    let concept: ConceptNode
    @State private var showingDetails = false

    var body: some View {
        Button(action: { showingDetails = true }) {
            HStack(spacing: 6) {
                Image(systemName: iconForType(concept.type))
                    .font(.caption)
                    .foregroundColor(colorForType(concept.type))

                Text(concept.name)
                    .font(.caption)

                if concept.referenceCount > 0 {
                    Text("\(concept.referenceCount)")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(colorForType(concept.type).opacity(0.1))
            .cornerRadius(6)
        }
        .buttonStyle(.plain)
        .popover(isPresented: $showingDetails) {
            ConceptQuickView(concept: concept)
        }
    }

    private func iconForType(_ type: ConceptNodeType) -> String {
        switch type {
        case .topic: return "book"
        case .person: return "person"
        case .technology: return "cpu"
        case .definition: return "text.book.closed"
        case .question: return "questionmark.circle"
        case .insight: return "lightbulb"
        case .resource: return "link"
        case .custom: return "star"
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

struct ConceptQuickView: View {
    let concept: ConceptNode

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(concept.name)
                        .font(.headline)

                    Text(concept.type.rawValue.capitalized)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()
            }

            Divider()

            // Description
            if let description = concept.conceptDescription {
                Text(description)
                    .font(.callout)
            }

            // Stats
            HStack(spacing: 16) {
                QuickStat(icon: "arrow.triangle.branch", value: concept.outgoingLinks.count, label: "Links")
                QuickStat(icon: "arrow.triangle.merge", value: concept.incomingLinks.count, label: "Backlinks")
                QuickStat(icon: "text.quote", value: concept.mentions.count, label: "Mentions")
                QuickStat(icon: "number", value: concept.referenceCount, label: "References")
            }

            // Connected concepts
            if !concept.linkedConcepts.isEmpty {
                Divider()

                VStack(alignment: .leading, spacing: 6) {
                    Text("Connected To")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(.secondary)

                    ForEach(concept.linkedConcepts.prefix(3)) { linked in
                        HStack {
                            Image(systemName: "arrow.right")
                                .font(.caption2)
                                .foregroundColor(.secondary)

                            Text(linked.name)
                                .font(.caption)
                        }
                    }
                }
            }
        }
        .padding()
        .frame(width: 300)
    }
}

struct QuickStat: View {
    let icon: String
    let value: Int
    let label: String

    var body: some View {
        VStack(spacing: 2) {
            HStack(spacing: 2) {
                Image(systemName: icon)
                    .font(.caption2)
                Text("\(value)")
                    .font(.caption)
            }
            .fontWeight(.semibold)

            Text(label)
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}
