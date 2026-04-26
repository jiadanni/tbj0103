import SwiftUI
import SwiftData

struct ArtifactPanelView: View {
    @Bindable var artifact: Artifact
    @Binding var isPresented: Bool
    
    @Environment(\.modelContext) private var modelContext
    @State private var copied = false
    @State private var showHistory = false
    @Query private var versions: [Artifact]
    
    init(artifact: Artifact, isPresented: Binding<Bool>) {
        self.artifact = artifact
        self._isPresented = isPresented
        
        let fileId = artifact.fileId
        // Fetch all artifacts with the same fileId to show history
        self._versions = Query(
            filter: #Predicate<Artifact> { $0.fileId == fileId },
            sort: \Artifact.version, order: .reverse
        )
    }
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack(spacing: 12) {
                Image(systemName: artifact.artifactType == "code" ? "chevron.left.forwardslash.chevron.right" : "doc.text")
                    .foregroundColor(.blue)
                    .padding(8)
                    .background(Color.blue.opacity(0.1))
                    .cornerRadius(6)
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(artifact.title)
                        .font(.headline)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    
                    Text("v\(artifact.version) • \(artifact.language)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
                Spacer()
                
                HStack(spacing: 4) {
                    Button(action: {
                        artifact.isPinned.toggle()
                        try? modelContext.save()
                    }) {
                        Image(systemName: artifact.isPinned ? "pin.fill" : "pin.slash")
                            .foregroundColor(artifact.isPinned ? .blue : .secondary)
                    }
                    .buttonStyle(.plain)
                    .padding(6)
                    .help(artifact.isPinned ? "Unpin Artifact" : "Pin to Workspace Context")
                    
                    Button(action: { showHistory.toggle() }) {
                        Image(systemName: "clock")
                            .foregroundColor(showHistory ? .blue : .secondary)
                    }
                    .buttonStyle(.plain)
                    .padding(6)
                    .help("Version History")
                    
                    Button(action: {
                        modelContext.delete(artifact)
                        try? modelContext.save()
                        isPresented = false
                    }) {
                        Image(systemName: "trash")
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(.plain)
                    .padding(6)
                    .help("Delete Artifact")
                    
                    Divider().frame(height: 16)
                    
                    Button(action: { isPresented = false }) {
                        Image(systemName: "xmark")
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(.plain)
                    .padding(6)
                }
            }
            .padding()
            .background(Color(nsColor: .windowBackgroundColor))
            
            Divider()
            
            // Content
            Group {
                if showHistory {
                    List(versions) { v in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("VERSION \(v.version)")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundColor(.blue)
                                Spacer()
                                Text(v.updatedAt.formatted(date: .abbreviated, time: .shortened))
                                    .font(.system(size: 10))
                                    .foregroundColor(.secondary)
                            }
                            Text(v.title).font(.subheadline)
                            Text("\(v.artifactType) • \(v.language)")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                        .padding(.vertical, 4)
                        .contentShape(Rectangle())
                        .opacity(v.id == artifact.id ? 1.0 : 0.6)
                    }
                    .listStyle(.sidebar)
                } else {
                    ScrollView {
                        Text(artifact.content)
                            .font(.system(.body, design: .monospaced))
                            .frame(maxWidth: .infinity, alignment: .topLeading)
                            .padding()
                            .textSelection(.enabled)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(nsColor: .controlBackgroundColor))
            
            Divider()
            
            // Footer
            HStack {
                Button(action: {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(artifact.content, forType: .string)
                    copied = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        copied = false
                    }
                }) {
                    Label(copied ? "Copied!" : "Copy Content", systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                .buttonStyle(.bordered)
                
                Spacer()
                
                HStack(spacing: 8) {
                    Text("\(artifact.tokenCount ?? 0) tokens")
                    Text("•")
                    Text(artifact.updatedAt.formatted(date: .numeric, time: .omitted))
                }
                .font(.caption)
                .foregroundColor(.secondary)
            }
            .padding()
            .background(Color(nsColor: .windowBackgroundColor))
        }
        .frame(width: 400)
    }
}
