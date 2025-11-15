import SwiftUI
import SwiftData

// MARK: - Concept Auto-Complete

struct ConceptAutoCompleteView: View {
    let suggestions: [ConceptNode]
    let onSelect: (ConceptNode) -> Void
    @State private var selectedIndex = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(suggestions.enumerated()), id: \.element.id) { index, concept in
                ConceptSuggestionRow(
                    concept: concept,
                    isSelected: index == selectedIndex
                )
                .contentShape(Rectangle())
                .onTapGesture {
                    onSelect(concept)
                }
                .background(index == selectedIndex ? Color.blue.opacity(0.1) : Color.clear)

                if index < suggestions.count - 1 {
                    Divider()
                }
            }
        }
        .frame(maxWidth: 300)
        .background(.ultraThinMaterial)
        .cornerRadius(8)
        .shadow(radius: 10)
        .padding(.top, 4)
    }

    func handleKeyPress(_ key: KeyEquivalent) -> Bool {
        switch key {
        case .downArrow:
            selectedIndex = min(selectedIndex + 1, suggestions.count - 1)
            return true
        case .upArrow:
            selectedIndex = max(selectedIndex - 1, 0)
            return true
        case .return:
            if selectedIndex < suggestions.count {
                onSelect(suggestions[selectedIndex])
            }
            return true
        default:
            return false
        }
    }
}

struct ConceptSuggestionRow: View {
    let concept: ConceptNode
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 12) {
            // Icon
            Image(systemName: iconForType(concept.type))
                .font(.body)
                .foregroundColor(colorForType(concept.type))
                .frame(width: 32, height: 32)
                .background(colorForType(concept.type).opacity(0.1))
                .cornerRadius(6)

            // Content
            VStack(alignment: .leading, spacing: 2) {
                Text(concept.name)
                    .font(.body)
                    .fontWeight(isSelected ? .medium : .regular)

                if let description = concept.conceptDescription {
                    Text(description)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer()

            // Stats
            HStack(spacing: 8) {
                if concept.referenceCount > 0 {
                    HStack(spacing: 2) {
                        Image(systemName: "number")
                            .font(.caption2)
                        Text("\(concept.referenceCount)")
                            .font(.caption2)
                    }
                    .foregroundColor(.secondary)
                }

                if !concept.linkedConcepts.isEmpty {
                    HStack(spacing: 2) {
                        Image(systemName: "link")
                            .font(.caption2)
                        Text("\(concept.linkedConcepts.count)")
                            .font(.caption2)
                    }
                    .foregroundColor(.secondary)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
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

// MARK: - Create New Concept Suggestion

struct CreateConceptSuggestion: View {
    let conceptName: String
    let onCreate: () -> Void

    var body: some View {
        Button(action: onCreate) {
            HStack(spacing: 12) {
                Image(systemName: "plus.circle.fill")
                    .font(.body)
                    .foregroundColor(.green)
                    .frame(width: 32, height: 32)
                    .background(Color.green.opacity(0.1))
                    .cornerRadius(6)

                VStack(alignment: .leading, spacing: 2) {
                    Text("Create \"\(conceptName)\"")
                        .font(.body)
                        .fontWeight(.medium)

                    Text("New concept")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    let config = ModelConfiguration(isStoredInMemoryOnly: true)
    let container = try! ModelContainer(for: ConceptNode.self, configurations: config)

    let concept1 = ConceptNode(name: "Swift Closures", description: "Self-contained blocks", nodeType: .topic)
    concept1.referenceCount = 5

    let concept2 = ConceptNode(name: "SwiftUI", description: "Declarative UI framework", nodeType: .technology)
    concept2.referenceCount = 12

    let concept3 = ConceptNode(name: "What is ARC?", description: "Memory management question", nodeType: .question)

    container.mainContext.insert(concept1)
    container.mainContext.insert(concept2)
    container.mainContext.insert(concept3)

    return VStack {
        ConceptAutoCompleteView(
            suggestions: [concept1, concept2, concept3],
            onSelect: { concept in
                print("Selected: \(concept.name)")
            }
        )

        Spacer()
    }
    .padding()
    .frame(width: 400, height: 300)
    .modelContainer(container)
}
