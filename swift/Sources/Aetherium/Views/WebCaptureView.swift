import SwiftData
import SwiftUI

struct WebCaptureView: View {
    let project: Workspace
    @Environment(\.modelContext) private var modelContext
    @Query private var captures: [WebCapture]
    
    @State private var query = ""
    @State private var showAddSheet = false
    @State private var newUrl = ""
    @State private var newTitle = ""
    @State private var selectedCapture: WebCapture?

    init(project: Workspace) {
        self.project = project
        let projectId = project.id
        self._captures = Query(
            filter: #Predicate<WebCapture> { $0.workspace?.id == projectId },
            sort: \WebCapture.createdAt, order: .reverse
        )
    }

    var filteredCaptures: [WebCapture] {
        if query.isEmpty { return captures }
        return captures.filter {
            $0.title.localizedCaseInsensitiveContains(query) ||
            $0.url.localizedCaseInsensitiveContains(query) ||
            ($0.summary ?? "").localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        HSplitView {
            // Left pane
            VStack(spacing: 0) {
                // Search & Add
                HStack {
                    HStack {
                        Image(systemName: "magnifyingglass").foregroundColor(.secondary)
                        TextField("Search captures...", text: $query)
                            .textFieldStyle(.plain)
                    }
                    .padding(6)
                    .background(Color(nsColor: .controlBackgroundColor))
                    .cornerRadius(6)
                    
                    Button {
                        showAddSheet = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .buttonStyle(.plain)
                    .padding(.leading, 4)
                }
                .padding()
                
                Divider()
                
                // List
                List(filteredCaptures, selection: $selectedCapture) { capture in
                    NavigationLink(value: capture) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(capture.title.isEmpty ? capture.url : capture.title)
                                .font(.subheadline)
                                .lineLimit(1)
                            Text(capture.url)
                                .font(.caption2)
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                            Text(capture.createdAt.formatted(date: .abbreviated, time: .omitted))
                                .font(.system(size: 9))
                                .foregroundColor(.secondary)
                        }
                    }
                }
                .listStyle(.sidebar)
            }
            .frame(minWidth: 200, idealWidth: 250, maxWidth: 350)
            
            // Right Pane
            if let selected = selectedCapture {
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Image(systemName: "globe").foregroundColor(.accentColor)
                        VStack(alignment: .leading) {
                            Text(selected.title).font(.headline)
                            Link(selected.url, destination: URL(string: selected.url)!)
                                .font(.caption)
                                .foregroundColor(.blue)
                        }
                        Spacer()
                        Button(role: .destructive) {
                            modelContext.delete(selected)
                            selectedCapture = nil
                            try? modelContext.save()
                        } label: {
                            Image(systemName: "trash")
                        }
                    }
                    .padding()
                    
                    Divider()
                    
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            if let summary = selected.summary, !summary.isEmpty {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("SUMMARY")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                    Text(summary)
                                        .font(.body)
                                }
                                .padding()
                                .background(Color(nsColor: .controlBackgroundColor))
                                .cornerRadius(8)
                            }
                            
                            Text(selected.content)
                                .font(.system(.body, design: .monospaced))
                                .foregroundColor(.secondary)
                        }
                        .padding()
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "globe")
                        .font(.system(size: 40))
                        .foregroundColor(.secondary.opacity(0.3))
                    Text("Select a capture to view")
                        .foregroundColor(.secondary)
                    Button("Add Web Capture") {
                        showAddSheet = true
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Web Captures")
        .sheet(isPresented: $showAddSheet) {
            VStack(spacing: 16) {
                Text("Add Web Capture").font(.headline)
                TextField("URL", text: $newUrl)
                    .textFieldStyle(.roundedBorder)
                TextField("Title (optional)", text: $newTitle)
                    .textFieldStyle(.roundedBorder)
                
                HStack {
                    Button("Cancel") { showAddSheet = false }
                    Button("Save") {
                        let cap = WebCapture(
                            url: newUrl,
                            title: newTitle,
                            content: "Pending...",
                            summary: nil,
                            isProcessed: false
                        )
                        cap.workspace = project
                        modelContext.insert(cap)
                        try? modelContext.save()
                        showAddSheet = false
                        newUrl = ""
                        newTitle = ""
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(newUrl.isEmpty)
                }
            }
            .padding()
            .frame(width: 300)
        }
    }
}
