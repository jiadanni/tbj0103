import SwiftUI

struct ShortestPathView: View {
    let concepts: [ConceptNode]

    @State private var sourceConcept: ConceptNode?
    @State private var targetConcept: ConceptNode?
    @State private var shortestPath: [ConceptNode]?
    @State private var hasComputed = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                // Controls
                VStack(spacing: 16) {
                    HStack {
                        Text("From:")
                            .fontWeight(.semibold)
                            .frame(width: 50, alignment: .leading)
                        Picker("Source", selection: $sourceConcept) {
                            Text("Select Source").tag(nil as ConceptNode?)
                            ForEach(concepts) { concept in
                                Text(concept.name).tag(concept as ConceptNode?)
                            }
                        }
                        .pickerStyle(.menu)
                        Spacer()
                    }

                    HStack {
                        Text("To:")
                            .fontWeight(.semibold)
                            .frame(width: 50, alignment: .leading)
                        Picker("Target", selection: $targetConcept) {
                            Text("Select Target").tag(nil as ConceptNode?)
                            ForEach(concepts) { concept in
                                Text(concept.name).tag(concept as ConceptNode?)
                            }
                        }
                        .pickerStyle(.menu)
                        Spacer()
                    }

                    Button("Find Path") {
                        if let source = sourceConcept, let target = targetConcept {
                            shortestPath = GraphAlgorithms.computeShortestPath(source: source, target: target)
                            hasComputed = true
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(sourceConcept == nil || targetConcept == nil || sourceConcept?.id == targetConcept?.id)
                }
                .padding()
                .background(Color.secondary.opacity(0.1))
                .cornerRadius(12)
                .padding(.horizontal)

                Divider()

                // Results
                if hasComputed {
                    if let path = shortestPath {
                        List {
                            Section("Path (\(path.count - 1) hops)") {
                                ForEach(Array(path.enumerated()), id: \.element.id) { index, concept in
                                    HStack {
                                        Text(concept.name)
                                        if index < path.count - 1 {
                                            Spacer()
                                            Image(systemName: "arrow.down")
                                                .foregroundColor(.secondary)
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        VStack {
                            Spacer()
                            HStack {
                                Spacer()
                                Text("No path found between these concepts.")
                                    .foregroundColor(.secondary)
                                Spacer()
                            }
                            Spacer()
                        }
                    }
                } else {
                    Spacer()
                }
            }
            .navigationTitle("Shortest Path")
            .onChange(of: sourceConcept) { _, _ in hasComputed = false }
            .onChange(of: targetConcept) { _, _ in hasComputed = false }
        }
        .frame(minWidth: 400, minHeight: 400)
    }
}
