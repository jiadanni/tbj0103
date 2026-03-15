import SwiftUI
import SwiftData

struct KnowledgeGraphView: View {
    @Environment(\.modelContext) private var modelContext
    let project: AetheriumProject

    @Query private var allConcepts: [ConceptNode]
    @State private var selectedConcept: ConceptNode?
    @State private var searchText = ""
    @State private var filterType: ConceptNodeType?
    @State private var showingStatistics = false
    @State private var graphLayout = GraphLayout.force

    enum GraphLayout {
        case force      // Force-directed
        case circular   // Circular layout
        case hierarchical // Top-down hierarchy
    }

    var filteredConcepts: [ConceptNode] {
        allConcepts.filter { concept in
            concept.project?.id == project.id &&
            (searchText.isEmpty || concept.name.localizedCaseInsensitiveContains(searchText)) &&
            (filterType == nil || concept.type == filterType)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header with controls
            graphControls

            Divider()

            // Main content
            HStack(spacing: 0) {
                // Graph visualization
                graphCanvas
                    .frame(maxWidth: .infinity)

                Divider()

                // Sidebar
                graphSidebar
                    .frame(width: 300)
            }
        }
        .navigationTitle("Knowledge Graph")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Button(action: { showingStatistics.toggle() }) {
                    Label("Statistics", systemImage: "chart.bar")
                }
            }
        }
        .sheet(isPresented: $showingStatistics) {
            GraphStatisticsView(concepts: filteredConcepts)
        }
    }

    // MARK: - Components

    private var graphControls: some View {
        HStack {
            // Search
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.secondary)
                TextField("Search concepts...", text: $searchText)
                    .textFieldStyle(.plain)
            }
            .padding(8)
            .background(Color.secondary.opacity(0.1))
            .cornerRadius(8)
            .frame(maxWidth: 300)

            // Type filter
            Picker("Type", selection: $filterType) {
                Text("All Types").tag(nil as ConceptNodeType?)
                ForEach(ConceptNodeType.allCases, id: \.self) { type in
                    Text(type.rawValue.capitalized).tag(type as ConceptNodeType?)
                }
            }
            .pickerStyle(.menu)

            Spacer()

            // Layout selector
            Picker("Layout", selection: $graphLayout) {
                Label("Force", systemImage: "circle.hexagonpath").tag(GraphLayout.force)
                Label("Circular", systemImage: "circle.circle").tag(GraphLayout.circular)
                Label("Hierarchical", systemImage: "square.stack.3d.down.right").tag(GraphLayout.hierarchical)
            }
            .pickerStyle(.segmented)
            .frame(width: 300)
        }
        .padding()
    }

    private var graphCanvas: some View {
        GeometryReader { geometry in
            ZStack {
                // Background
                Color.secondary.opacity(0.05)

                // Graph rendering
                switch graphLayout {
                case .force:
                    ForceDirectedGraphView(
                        concepts: filteredConcepts,
                        selectedConcept: $selectedConcept,
                        size: geometry.size
                    )
                case .circular:
                    CircularGraphView(
                        concepts: filteredConcepts,
                        selectedConcept: $selectedConcept,
                        size: geometry.size
                    )
                case .hierarchical:
                    HierarchicalGraphView(
                        concepts: filteredConcepts,
                        selectedConcept: $selectedConcept,
                        size: geometry.size
                    )
                }

                // Empty state
                if filteredConcepts.isEmpty {
                    ContentUnavailableView(
                        "No Concepts",
                        systemImage: "network.slash",
                        description: Text("Extract concepts from chats and documents to build your knowledge graph")
                    )
                }
            }
        }
    }

    private var graphSidebar: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let selected = selectedConcept {
                // Concept details
                conceptDetails(selected)
            } else {
                // Overview
                graphOverview
            }

            Spacer()
        }
        .padding()
    }

    private func conceptDetails(_ concept: ConceptNode) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Header
                HStack {
                    Image(systemName: iconForType(concept.type))
                        .font(.title2)
                        .foregroundColor(colorForType(concept.type))

                    VStack(alignment: .leading, spacing: 4) {
                        Text(concept.name)
                            .font(.headline)

                        Text(concept.type.rawValue.capitalized)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    Spacer()

                    Button(action: { selectedConcept = nil }) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(.plain)
                }

                Divider()

                // Description
                if let description = concept.conceptDescription {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Description")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        Text(description)
                            .font(.body)
                    }
                }

                // Statistics
                VStack(alignment: .leading, spacing: 8) {
                    Text("Statistics")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    HStack(spacing: 16) {
                        StatPill(
                            icon: "arrow.triangle.branch",
                            value: "\(concept.outgoingLinks.count)",
                            label: "Links"
                        )

                        StatPill(
                            icon: "arrow.triangle.merge",
                            value: "\(concept.incomingLinks.count)",
                            label: "Backlinks"
                        )

                        StatPill(
                            icon: "text.quote",
                            value: "\(concept.mentions.count)",
                            label: "Mentions"
                        )
                    }
                }

                Divider()

                // Connected concepts
                if !concept.linkedConcepts.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Connected Concepts")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        ForEach(concept.linkedConcepts.prefix(5)) { linked in
                            Button(action: { selectedConcept = linked }) {
                                HStack {
                                    Image(systemName: iconForType(linked.type))
                                        .foregroundColor(colorForType(linked.type))
                                    Text(linked.name)
                                        .font(.caption)
                                    Spacer()
                                    Image(systemName: "arrow.right")
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                }
                                .padding(8)
                                .background(Color.secondary.opacity(0.1))
                                .cornerRadius(6)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                Divider()

                // Tags
                if !concept.tags.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Tags")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        FlowLayout(spacing: 6) {
                            ForEach(concept.tags, id: \.self) { tag in
                                Text("#\(tag)")
                                    .font(.caption)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 4)
                                    .background(Color.blue.opacity(0.1))
                                    .foregroundColor(.blue)
                                    .cornerRadius(4)
                            }
                        }
                    }
                }
            }
        }
    }

    private var graphOverview: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Knowledge Graph")
                .font(.headline)

            VStack(alignment: .leading, spacing: 8) {
                StatRow(
                    icon: "circle.grid.cross",
                    label: "Total Concepts",
                    value: "\(filteredConcepts.count)"
                )

                StatRow(
                    icon: "arrow.triangle.branch",
                    label: "Total Links",
                    value: "\(filteredConcepts.reduce(0) { $0 + $1.outgoingLinks.count })"
                )

                StatRow(
                    icon: "chart.line.uptrend.xyaxis",
                    label: "Avg Connections",
                    value: String(format: "%.1f", averageConnections)
                )
            }

            Divider()

            Text("Top Concepts")
                .font(.caption)
                .foregroundColor(.secondary)

            ForEach(topConcepts) { concept in
                Button(action: { selectedConcept = concept }) {
                    HStack {
                        Image(systemName: iconForType(concept.type))
                            .foregroundColor(colorForType(concept.type))

                        Text(concept.name)
                            .font(.caption)
                            .lineLimit(1)

                        Spacer()

                        Text("\(concept.referenceCount)")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    .padding(.vertical, 4)
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Computed Properties

    private var averageConnections: Double {
        guard !filteredConcepts.isEmpty else { return 0.0 }
        let totalLinks = filteredConcepts.reduce(0) { $0 + $1.outgoingLinks.count }
        return Double(totalLinks) / Double(filteredConcepts.count)
    }

    private var topConcepts: [ConceptNode] {
        filteredConcepts
            .sorted { $0.referenceCount > $1.referenceCount }
            .prefix(5)
            .map { $0 }
    }

    // MARK: - Helpers

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

// MARK: - Graph Renderers

struct ForceDirectedGraphView: View {
    let concepts: [ConceptNode]
    @Binding var selectedConcept: ConceptNode?
    let size: CGSize

    @State private var nodePositions: [UUID: CGPoint] = [:]

    var body: some View {
        Canvas { context, size in
            // Draw links
            for concept in concepts {
                guard let sourcePos = nodePositions[concept.id] else { continue }

                for link in concept.outgoingLinks {
                    guard let target = link.target,
                          let targetPos = nodePositions[target.id] else { continue }

                    var path = Path()
                    path.move(to: sourcePos)
                    path.addLine(to: targetPos)

                    context.stroke(
                        path,
                        with: .color(.secondary.opacity(0.3)),
                        lineWidth: CGFloat(link.strength) * 2
                    )
                }
            }

            // Draw nodes
            for concept in concepts {
                guard let pos = nodePositions[concept.id] else { continue }

                let isSelected = selectedConcept?.id == concept.id
                let radius: CGFloat = isSelected ? 8 : 6

                context.fill(
                    Circle().path(in: CGRect(x: pos.x - radius, y: pos.y - radius, width: radius * 2, height: radius * 2)),
                    with: .color(colorForType(concept.type))
                )
            }
        }
        .overlay {
            // Node labels
            ForEach(concepts) { concept in
                if let pos = nodePositions[concept.id] {
                    Text(concept.name)
                        .font(.caption2)
                        .padding(4)
                        .background(.ultraThinMaterial)
                        .cornerRadius(4)
                        .position(x: pos.x, y: pos.y - 20)
                        .onTapGesture {
                            selectedConcept = concept
                        }
                }
            }
        }
        .onAppear {
            initializeLayout()
        }
        .onChange(of: concepts.count) { _, _ in
            initializeLayout()
        }
    }

    private func initializeLayout() {
        // Simple random layout (in production, use force-directed algorithm)
        var positions: [UUID: CGPoint] = [:]

        for (index, concept) in concepts.enumerated() {
            let angle = Double(index) * (2.0 * .pi / Double(concepts.count))
            let radius = min(size.width, size.height) * 0.35

            let x = size.width / 2 + CGFloat(cos(angle)) * radius
            let y = size.height / 2 + CGFloat(sin(angle)) * radius

            positions[concept.id] = CGPoint(x: x, y: y)
        }

        nodePositions = positions
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

struct CircularGraphView: View {
    let concepts: [ConceptNode]
    @Binding var selectedConcept: ConceptNode?
    let size: CGSize

    var body: some View {
        Text("Circular Layout")
            .foregroundColor(.secondary)
    }
}

struct HierarchicalGraphView: View {
    let concepts: [ConceptNode]
    @Binding var selectedConcept: ConceptNode?
    let size: CGSize

    var body: some View {
        Text("Hierarchical Layout")
            .foregroundColor(.secondary)
    }
}

// MARK: - Supporting Views

struct StatRow: View {
    let icon: String
    let label: String
    let value: String

    var body: some View {
        HStack {
            Image(systemName: icon)
                .foregroundColor(.secondary)
                .frame(width: 20)

            Text(label)
                .font(.caption)

            Spacer()

            Text(value)
                .font(.caption)
                .fontWeight(.semibold)
        }
    }
}

struct StatPill: View {
    let icon: String
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                Text(value)
            }
            .font(.callout)
            .fontWeight(.semibold)

            Text(label)
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(Color.secondary.opacity(0.1))
        .cornerRadius(8)
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = FlowResult(in: proposal.width ?? 0, subviews: subviews, spacing: spacing)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = FlowResult(in: bounds.width, subviews: subviews, spacing: spacing)
        for (index, subview) in subviews.enumerated() {
            subview.place(at: CGPoint(x: bounds.minX + result.positions[index].x, y: bounds.minY + result.positions[index].y), proposal: .unspecified)
        }
    }

    struct FlowResult {
        var size: CGSize
        var positions: [CGPoint]

        init(in maxWidth: CGFloat, subviews: Subviews, spacing: CGFloat) {
            var positions: [CGPoint] = []
            var size: CGSize = .zero
            var x: CGFloat = 0
            var y: CGFloat = 0
            var lineHeight: CGFloat = 0

            for subview in subviews {
                let subviewSize = subview.sizeThatFits(.unspecified)

                if x + subviewSize.width > maxWidth && x > 0 {
                    x = 0
                    y += lineHeight + spacing
                    lineHeight = 0
                }

                positions.append(CGPoint(x: x, y: y))
                lineHeight = max(lineHeight, subviewSize.height)
                x += subviewSize.width + spacing
                size.width = max(size.width, x)
            }

            size.height = y + lineHeight
            self.size = size
            self.positions = positions
        }
    }
}

struct GraphStatisticsView: View {
    let concepts: [ConceptNode]

    var body: some View {
        NavigationStack {
            List {
                Section("Overview") {
                    LabeledContent("Total Concepts", value: "\(concepts.count)")
                    LabeledContent("Total Links", value: "\(totalLinks)")
                    LabeledContent("Average Connections", value: String(format: "%.2f", averageConnections))
                }

                Section("Top Concepts") {
                    ForEach(topConcepts.prefix(10)) { concept in
                        HStack {
                            Text(concept.name)
                            Spacer()
                            Text("\(concept.referenceCount) refs")
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }
            .navigationTitle("Graph Statistics")
        }
        .frame(width: 500, height: 600)
    }

    private var totalLinks: Int {
        concepts.reduce(0) { $0 + $1.outgoingLinks.count }
    }

    private var averageConnections: Double {
        guard !concepts.isEmpty else { return 0.0 }
        return Double(totalLinks) / Double(concepts.count)
    }

    private var topConcepts: [ConceptNode] {
        concepts.sorted { $0.referenceCount > $1.referenceCount }
    }
}


