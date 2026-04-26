import SwiftData
import SwiftUI

struct KnowledgeGraphView: View {
    @Environment(\.modelContext) private var modelContext
    let project: Workspace

    @Query private var allConcepts: [ConceptNode]
    @State private var selectedConcept: ConceptNode?
    @State private var searchText = ""
    @State private var filterType: ConceptNodeType?
    @State private var showingStatistics = false
    @State private var showingShortestPath = false
    @State private var showingEvolution = false
    @State private var evolutionDate: Date?
    @State private var graphLayout = GraphLayout.force
    @State private var isExtractingConcepts = false
    @State private var extractionProgress: Double = 0.0
    @State private var extractionError: String?
    @State private var showDemoTip = false
    @EnvironmentObject var demoModeManager: DemoModeManager

    enum GraphLayout {
        case force      // Force-directed
        case circular   // Circular layout
        case hierarchical // Top-down hierarchy
    }

    var filteredConcepts: [ConceptNode] {
        allConcepts.filter { concept in
            let dateCondition: Bool
            if let targetDate = evolutionDate {
                dateCondition = concept.createdAt <= targetDate
            } else {
                dateCondition = true
            }

            return concept.project?.id == project.id &&
            (searchText.isEmpty || concept.name.localizedCaseInsensitiveContains(searchText)) &&
            (filterType == nil || concept.type == filterType) &&
            dateCondition
        }
    }

    private var minDate: Date {
        allConcepts.map { $0.createdAt }.min() ?? Date()
    }

    private var maxDate: Date {
        allConcepts.map { $0.createdAt }.max() ?? Date()
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header with controls
            graphControls

            if showingEvolution {
                Divider()
                evolutionControls
            }

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
                Button(action: extractConcepts) {
                    Label(
                        isExtractingConcepts ? "Extracting..." : "Extract Concepts",
                        systemImage: "brain.head.profile"
                    )
                }
                .disabled(isExtractingConcepts || (project.chatSessions.isEmpty && project.sources.isEmpty))
            }

            ToolbarItem(placement: .automatic) {
                Button(action: {
                    showingEvolution.toggle()
                    if showingEvolution && evolutionDate == nil {
                        evolutionDate = maxDate
                    } else if !showingEvolution {
                        evolutionDate = nil
                    }
                }) {
                    Label("Evolution", systemImage: "clock.arrow.circlepath")
                }
                .tint(showingEvolution ? .blue : .primary)
            }

            ToolbarItem(placement: .automatic) {
                Button(action: { showingShortestPath.toggle() }) {
                    Label("Path", systemImage: "point.topleft.down.curvedto.point.bottomright.up")
                }
            }

            ToolbarItem(placement: .automatic) {
                Button(action: { showingStatistics.toggle() }) {
                    Label("Statistics", systemImage: "chart.bar")
                }
            }
        }
        .overlay {
            if isExtractingConcepts {
                OperationOverlay(
                    title: "Extracting Concepts",
                    subtitle: "Analyzing chats and documents...",
                    icon: "brain.head.profile",
                    progress: extractionProgress
                )
            }
        }
        .overlay(alignment: .bottom) {
            if showDemoTip {
                DemoTipCallout(message: "Tap any node to see connections", systemImage: "cursorarrow.rays")
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .padding(.bottom, 24)
            }
        }
        .onAppear {
            guard demoModeManager.isActive else { return }
            withAnimation(.easeIn(duration: 0.3).delay(0.6)) { showDemoTip = true }
            Task {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                withAnimation(.easeOut(duration: 0.3)) { showDemoTip = false }
            }
        }
        .sheet(isPresented: $showingStatistics) {
            GraphStatisticsView(concepts: filteredConcepts)
        }
        .sheet(isPresented: $showingShortestPath) {
            ShortestPathView(concepts: filteredConcepts)
        }
        .task {
            // Auto-extract concepts when the graph is empty and there's content to process
            let hasContent = !project.chatSessions.isEmpty || !project.sources.isEmpty
            if filteredConcepts.isEmpty && hasContent && !isExtractingConcepts {
                extractConcepts()
            }
        }
    }

    // MARK: - Components

    private var evolutionControls: some View {
        HStack {
            Text("Graph Evolution")
                .font(.headline)

            let minD = minDate
            let maxD = maxDate

            if minD < maxD {
                Slider(
                    value: Binding(
                        get: { self.evolutionDate?.timeIntervalSince1970 ?? maxD.timeIntervalSince1970 },
                        set: { self.evolutionDate = Date(timeIntervalSince1970: $0) }
                    ),
                    in: minD.timeIntervalSince1970...maxD.timeIntervalSince1970
                )

                Text(evolutionDate?.formatted(date: .abbreviated, time: .shortened) ?? "")
                    .font(.caption)
                    .frame(width: 150, alignment: .trailing)
            } else {
                Text("Not enough data to show evolution.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color.secondary.opacity(0.05))
    }

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

    // MARK: - Concept Extraction

    private func extractConcepts() {
        guard !isExtractingConcepts else { return }
        isExtractingConcepts = true
        extractionProgress = 0.0
        extractionError = nil

        Task {
            do {
                let linkingEngine = LinkingEngine(modelContext: modelContext)
                let orchestrator = ModelOrchestrator(ollamaService: OllamaService())
                let extractor = ConceptExtractor(
                    modelOrchestrator: orchestrator,
                    linkingEngine: linkingEngine
                )

                let totalItems = project.chatSessions.count + project.sources.filter({ $0.document != nil }).count
                var processedItems = 0

                // Extract from chats
                for chat in project.chatSessions {
                    let concepts = try await extractor.extractFromChat(chat)
                    for concept in concepts {
                        concept.project = project
                        modelContext.insert(concept)
                    }
                    processedItems += 1
                    extractionProgress = Double(processedItems) / Double(max(totalItems, 1))
                }

                // Extract from documents
                for source in project.sources {
                    if let document = source.document {
                        let concepts = try await extractor.extractFromDocument(document)
                        for concept in concepts {
                            concept.project = project
                            modelContext.insert(concept)
                        }
                    }
                    processedItems += 1
                    extractionProgress = Double(processedItems) / Double(max(totalItems, 1))
                }

                // Auto-link extracted concepts
                await extractor.autoLinkConcepts(
                    filteredConcepts + project.concepts
                )

                extractionProgress = 1.0
            } catch {
                extractionError = error.localizedDescription
            }
            isExtractingConcepts = false
        }
    }
}

// MARK: - Graph Renderers

// Lightweight edge value type used by Canvas — avoids per-frame SwiftData relationship faults.
private struct GraphEdge {
    let from: UUID
    let to: UUID
    let lineWidth: CGFloat
}

// Lightweight node snapshot used by the background force simulation.
private struct GraphNodeSnapshot: @unchecked Sendable {
    let id: UUID
    let linkedIDs: [UUID]
}

struct ForceDirectedGraphView: View {
    let concepts: [ConceptNode]
    @Binding var selectedConcept: ConceptNode?
    let size: CGSize

    @State private var nodePositions: [UUID: CGPoint] = [:]
    // Pre-computed edges: built once per layout so Canvas never touches SwiftData relationships.
    @State private var edgeSnapshot: [GraphEdge] = []
    @State private var simTask: Task<Void, Never>?
    // Zoom
    @GestureState private var magnifyDelta: CGFloat = 1.0
    @State private var zoom: CGFloat = 1.0

    private var effectiveZoom: CGFloat { zoom * magnifyDelta }

    var body: some View {
        let showAllLabels = effectiveZoom >= 0.6 && concepts.count <= 75
        let showHubLabels = effectiveZoom >= 0.4 && concepts.count > 75

        ZStack {
            // Canvas: draws edges and node circles without touching SwiftData
            Canvas { context, _ in
                for edge in edgeSnapshot {
                    guard let src = nodePositions[edge.from],
                          let dst = nodePositions[edge.to] else { continue }
                    var path = Path()
                    path.move(to: src)
                    path.addLine(to: dst)
                    context.stroke(path, with: .color(.secondary.opacity(0.3)), lineWidth: edge.lineWidth)
                }
                for concept in concepts {
                    guard let pos = nodePositions[concept.id] else { continue }
                    let isSelected = selectedConcept?.id == concept.id
                    let r: CGFloat = isSelected ? 9 : 6
                    context.fill(
                        Circle().path(in: CGRect(x: pos.x - r, y: pos.y - r, width: r * 2, height: r * 2)),
                        with: .color(colorForType(concept.type))
                    )
                }
            }

            // Label overlay with LOD: avoid creating N views for large graphs when zoomed out
            if showAllLabels || showHubLabels {
                let visibleConcepts = showAllLabels ? concepts : concepts.filter { $0.referenceCount > 2 }
                ForEach(visibleConcepts) { concept in
                    if let pos = nodePositions[concept.id] {
                        Text(concept.name)
                            .font(.caption2)
                            .padding(4)
                            .background(.ultraThinMaterial)
                            .cornerRadius(4)
                            .position(x: pos.x, y: pos.y - 18)
                            .onTapGesture { selectedConcept = concept }
                    }
                }
            }
        }
        .scaleEffect(effectiveZoom, anchor: .center)
        .gesture(
            MagnifyGesture()
                .updating($magnifyDelta) { value, state, _ in
                    state = value.magnification
                }
                .onEnded { value in
                    zoom = max(0.25, min(4.0, zoom * value.magnification))
                }
        )
        .onAppear { initializeLayout() }
        .onChange(of: concepts.count) { _, _ in initializeLayout() }
    }

    private func initializeLayout() {
        simTask?.cancel()

        // Circular seed positions
        var positions: [UUID: CGPoint] = [:]
        for (index, concept) in concepts.enumerated() {
            let angle = Double(index) * (2.0 * .pi / Double(max(concepts.count, 1)))
            let radius = min(size.width, size.height) * 0.35
            positions[concept.id] = CGPoint(
                x: size.width / 2 + CGFloat(cos(angle)) * radius,
                y: size.height / 2 + CGFloat(sin(angle)) * radius
            )
        }
        nodePositions = positions

        // Snapshot edges once so Canvas never faults SwiftData relationships per frame
        edgeSnapshot = concepts.flatMap { concept -> [GraphEdge] in
            concept.outgoingLinks.compactMap { link -> GraphEdge? in
                guard let targetID = link.target?.id else { return nil }
                return GraphEdge(from: concept.id, to: targetID, lineWidth: CGFloat(link.strength) * 2)
            }
        }

        guard concepts.count > 1 else { return }

        // Build Sendable snapshots for the background task
        let nodeSnapshots = concepts.map { c in
            GraphNodeSnapshot(id: c.id, linkedIDs: c.outgoingLinks.compactMap { $0.target?.id })
        }
        let w = size.width, h = size.height

        simTask = Task.detached(priority: .utility) {
            let finalPositions = Self.runFruchtermanReingold(
                nodes: nodeSnapshots,
                initialPositions: positions,
                width: w,
                height: h
            )
            guard !Task.isCancelled else { return }
            await MainActor.run { nodePositions = finalPositions }
        }
    }

    /// Fruchterman–Reingold force-directed layout.
    /// Runs entirely on the cooperative thread pool; returns the final position dictionary.
    private static func runFruchtermanReingold(
        nodes: [GraphNodeSnapshot],
        initialPositions: [UUID: CGPoint],
        width: CGFloat,
        height: CGFloat
    ) -> [UUID: CGPoint] {
        guard nodes.count > 1 else { return initialPositions }

        let area = width * height
        let k = sqrt(area / CGFloat(nodes.count)) * 0.8
        var temperature = width / 8.0
        let cooling: CGFloat = 0.96
        let iterations = min(180, 60 + nodes.count)

        var pos = initialPositions

        for _ in 0..<iterations {
            var disp: [UUID: CGVector] = Dictionary(uniqueKeysWithValues: nodes.map { ($0.id, .zero) })

            // Repulsive forces between every pair
            for i in 0..<nodes.count {
                for j in (i + 1)..<nodes.count {
                    let a = nodes[i].id, b = nodes[j].id
                    guard let pa = pos[a], let pb = pos[b] else { continue }
                    let dx = pa.x - pb.x, dy = pa.y - pb.y
                    let dist = max(sqrt(dx * dx + dy * dy), 0.01)
                    let rep = k * k / dist
                    let fx = dx / dist * rep, fy = dy / dist * rep
                    disp[a]?.dx += fx;  disp[a]?.dy += fy
                    disp[b]?.dx -= fx;  disp[b]?.dy -= fy
                }
            }

            // Attractive forces along edges
            for node in nodes {
                guard let pa = pos[node.id] else { continue }
                for linkedID in node.linkedIDs {
                    guard let pb = pos[linkedID] else { continue }
                    let dx = pb.x - pa.x, dy = pb.y - pa.y
                    let dist = max(sqrt(dx * dx + dy * dy), 0.01)
                    let att = dist * dist / k
                    let fx = dx / dist * att, fy = dy / dist * att
                    disp[node.id]?.dx += fx;    disp[node.id]?.dy += fy
                    disp[linkedID]?.dx -= fx;   disp[linkedID]?.dy -= fy
                }
            }

            // Apply displacements, clamped to temperature, then bound to canvas
            for node in nodes {
                guard var p = pos[node.id], let d = disp[node.id] else { continue }
                let len = max(sqrt(d.dx * d.dx + d.dy * d.dy), 0.01)
                let clamp = min(len, temperature)
                p.x += d.dx / len * clamp
                p.y += d.dy / len * clamp
                p.x = max(20, min(width - 20, p.x))
                p.y = max(20, min(height - 20, p.y))
                pos[node.id] = p
            }

            temperature *= cooling
        }

        return pos
    }

    private func colorForType(_ type: ConceptNodeType) -> Color {
        switch type {
        case .topic:      return .blue
        case .person:     return .purple
        case .technology: return .green
        case .definition: return .orange
        case .question:   return .red
        case .insight:    return .yellow
        case .resource:   return .cyan
        case .custom:     return .gray
        }
    }
}

struct CircularGraphView: View {
    let concepts: [ConceptNode]
    @Binding var selectedConcept: ConceptNode?
    let size: CGSize

    // Positions are pure functions of the concepts array — no State needed.
    private var positions: [UUID: CGPoint] {
        var result: [UUID: CGPoint] = [:]
        let count = max(concepts.count, 1)
        let radius = min(size.width, size.height) * 0.38
        for (index, concept) in concepts.enumerated() {
            let angle = Double(index) * (2.0 * .pi / Double(count))
            result[concept.id] = CGPoint(
                x: size.width / 2 + CGFloat(cos(angle)) * radius,
                y: size.height / 2 + CGFloat(sin(angle)) * radius
            )
        }
        return result
    }

    private var edgeSnapshot: [GraphEdge] {
        concepts.flatMap { concept in
            concept.outgoingLinks.compactMap { link -> GraphEdge? in
                guard let targetID = link.target?.id else { return nil }
                return GraphEdge(from: concept.id, to: targetID, lineWidth: CGFloat(link.strength) * 2)
            }
        }
    }

    var body: some View {
        let pos = positions
        let edges = edgeSnapshot
        let showLabels = concepts.count <= 60

        ZStack {
            Canvas { context, _ in
                for edge in edges {
                    guard let src = pos[edge.from], let dst = pos[edge.to] else { continue }
                    var path = Path()
                    path.move(to: src); path.addLine(to: dst)
                    context.stroke(path, with: .color(.secondary.opacity(0.3)), lineWidth: edge.lineWidth)
                }
                for concept in concepts {
                    guard let p = pos[concept.id] else { continue }
                    let r: CGFloat = selectedConcept?.id == concept.id ? 9 : 6
                    context.fill(
                        Circle().path(in: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)),
                        with: .color(colorForType(concept.type))
                    )
                }
            }

            if showLabels {
                ForEach(concepts) { concept in
                    if let p = pos[concept.id] {
                        Text(concept.name)
                            .font(.caption2)
                            .padding(4)
                            .background(.ultraThinMaterial)
                            .cornerRadius(4)
                            .position(x: p.x, y: p.y - 18)
                            .onTapGesture { selectedConcept = concept }
                    }
                }
            }
        }
    }

    private func colorForType(_ type: ConceptNodeType) -> Color {
        switch type {
        case .topic:      return .blue
        case .person:     return .purple
        case .technology: return .green
        case .definition: return .orange
        case .question:   return .red
        case .insight:    return .yellow
        case .resource:   return .cyan
        case .custom:     return .gray
        }
    }
}

struct HierarchicalGraphView: View {
    let concepts: [ConceptNode]
    @Binding var selectedConcept: ConceptNode?
    let size: CGSize

    // Group nodes by type; each type occupies its own horizontal row.
    private var positions: [UUID: CGPoint] {
        var result: [UUID: CGPoint] = [:]
        let rows = ConceptNodeType.allCases
            .compactMap { type -> (ConceptNodeType, [ConceptNode])? in
                let group = concepts.filter { $0.type == type }
                return group.isEmpty ? nil : (type, group)
            }
        guard !rows.isEmpty else { return result }
        let rowHeight = size.height / CGFloat(rows.count)
        for (rowIdx, (_, nodesInRow)) in rows.enumerated() {
            let colWidth = size.width / CGFloat(max(nodesInRow.count, 1))
            for (colIdx, concept) in nodesInRow.enumerated() {
                result[concept.id] = CGPoint(
                    x: colWidth * (CGFloat(colIdx) + 0.5),
                    y: rowHeight * (CGFloat(rowIdx) + 0.5)
                )
            }
        }
        return result
    }

    private var edgeSnapshot: [GraphEdge] {
        concepts.flatMap { concept in
            concept.outgoingLinks.compactMap { link -> GraphEdge? in
                guard let targetID = link.target?.id else { return nil }
                return GraphEdge(from: concept.id, to: targetID, lineWidth: CGFloat(link.strength) * 2)
            }
        }
    }

    var body: some View {
        let pos = positions
        let edges = edgeSnapshot
        let rowTypes = ConceptNodeType.allCases.filter { type in concepts.contains { $0.type == type } }
        let rowHeight = size.height / CGFloat(max(rowTypes.count, 1))

        ZStack {
            // Row type labels on the left edge
            VStack(spacing: 0) {
                ForEach(rowTypes, id: \.self) { type in
                    Text(type.rawValue.capitalized)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .frame(maxWidth: .infinity, maxHeight: rowHeight, alignment: .leading)
                        .padding(.leading, 6)
                }
            }

            Canvas { context, _ in
                for edge in edges {
                    guard let src = pos[edge.from], let dst = pos[edge.to] else { continue }
                    var path = Path()
                    path.move(to: src); path.addLine(to: dst)
                    context.stroke(path, with: .color(.secondary.opacity(0.3)), lineWidth: edge.lineWidth)
                }
                for concept in concepts {
                    guard let p = pos[concept.id] else { continue }
                    let r: CGFloat = selectedConcept?.id == concept.id ? 9 : 6
                    context.fill(
                        Circle().path(in: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)),
                        with: .color(colorForType(concept.type))
                    )
                }
            }

            if concepts.count <= 60 {
                ForEach(concepts) { concept in
                    if let p = pos[concept.id] {
                        Text(concept.name)
                            .font(.caption2)
                            .padding(4)
                            .background(.ultraThinMaterial)
                            .cornerRadius(4)
                            .position(x: p.x, y: p.y - 18)
                            .onTapGesture { selectedConcept = concept }
                    }
                }
            }
        }
    }

    private func colorForType(_ type: ConceptNodeType) -> Color {
        switch type {
        case .topic:      return .blue
        case .person:     return .purple
        case .technology: return .green
        case .definition: return .orange
        case .question:   return .red
        case .insight:    return .yellow
        case .resource:   return .cyan
        case .custom:     return .gray
        }
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

    @State private var stats: GraphStatistics?
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            Group {
                if let stats = stats {
                    List {
                        Section("Overview") {
                            LabeledContent("Total Concepts", value: "\(stats.totalNodes)")
                            LabeledContent("Total Links", value: "\(stats.totalLinks)")
                            LabeledContent("Average Connections", value: String(format: "%.2f", stats.averageConnections))
                        }

                        Section("Most Connected (Reference Count)") {
                            let items = stats.mostConnectedConcepts
                            ForEach(0..<items.count, id: \.self) { index in
                                let concept = items[index].0
                                let count = items[index].1
                                HStack {
                                    Text(concept.name)
                                    Spacer()
                                    Text("\(count) refs")
                                        .foregroundColor(.secondary)
                                }
                            }
                        }

                        Section("Top Concepts (PageRank)") {
                            let sortedPageRank = Array(stats.pageRankScores.sorted { $0.value > $1.value }.prefix(5))
                            ForEach(0..<sortedPageRank.count, id: \.self) { index in
                                let key = sortedPageRank[index].key
                                let score = sortedPageRank[index].value
                                if let concept = concepts.first(where: { $0.id == key }) {
                                    HStack {
                                        Text(concept.name)
                                        Spacer()
                                        Text(String(format: "%.4f", score))
                                            .foregroundColor(.secondary)
                                    }
                                }
                            }
                        }

                        Section("Top Hubs (Centrality)") {
                            let sortedCentrality = Array(stats.centralityScores.sorted { $0.value > $1.value }.prefix(5))
                            ForEach(0..<sortedCentrality.count, id: \.self) { index in
                                let key = sortedCentrality[index].key
                                let score = sortedCentrality[index].value
                                if let concept = concepts.first(where: { $0.id == key }) {
                                    HStack {
                                        Text(concept.name)
                                        Spacer()
                                        Text("\(score) in-links")
                                            .foregroundColor(.secondary)
                                    }
                                }
                            }
                        }

                        Section("Communities (Topic Clusters)") {
                            let communities = stats.communities
                            let grouped = Dictionary(grouping: concepts, by: { communities[$0.id] ?? "Unknown" })
                            let sortedGroups = Array(grouped.sorted(by: { $0.value.count > $1.value.count }))

                            ForEach(0..<sortedGroups.count, id: \.self) { index in
                                let clusterNodes = sortedGroups[index].value
                                if clusterNodes.count > 1 {
                                    DisclosureGroup {
                                        ForEach(clusterNodes) { node in
                                            Text(node.name)
                                                .font(.caption)
                                                .padding(.leading)
                                        }
                                    } label: {
                                        HStack {
                                            Text("Cluster")
                                            Spacer()
                                            Text("\(clusterNodes.count) items")
                                                .foregroundColor(.secondary)
                                        }
                                    }
                                }
                            }
                        }

                        Section("Degree Distribution") {
                            let sortedDist = Array(stats.degreeDistribution.sorted { $0.key < $1.key })
                            ForEach(0..<sortedDist.count, id: \.self) { index in
                                let degree = sortedDist[index].key
                                let count = sortedDist[index].value
                                HStack {
                                    Text("\(degree) links")
                                    Spacer()
                                    Text("\(count) concept(s)")
                                        .foregroundColor(.secondary)
                                }
                            }
                        }

                        Section("Evolution Summary") {
                            if stats.evolution.isEmpty {
                                Text("No evolution data.")
                                    .foregroundColor(.secondary)
                            } else {
                                let evs = stats.evolution
                                ForEach(0..<evs.count, id: \.self) { index in
                                    let date = evs[index].0
                                    let nodes = evs[index].1
                                    let links = evs[index].2
                                    HStack {
                                        Text(date.formatted(date: .abbreviated, time: .omitted))
                                        Spacer()
                                        Text("\(nodes) nodes, \(links) links")
                                            .foregroundColor(.secondary)
                                    }
                                }
                            }
                        }
                    }
                } else if isLoading {
                    ProgressView("Computing Graph Statistics...")
                } else {
                    Text("Failed to load statistics.")
                        .foregroundColor(.secondary)
                }
            }
            .navigationTitle("Graph Statistics")
            .task {
                isLoading = true
                let computed = GraphStatistics.compute(from: concepts)
                await MainActor.run {
                    self.stats = computed
                    self.isLoading = false
                }
            }
        }
        .frame(width: 500, height: 600)
    }
}
