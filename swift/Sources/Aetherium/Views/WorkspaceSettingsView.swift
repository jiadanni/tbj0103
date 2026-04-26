import SwiftData
import SwiftUI

struct WorkspaceSettingsView: View {
    @Environment(\.modelContext) private var modelContext
    @Query private var workspaces: [Workspace]
    
    @State private var showingNewWorkspace = false
    @State private var newName = ""
    @State private var isAnalyzing = false
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                VStack(alignment: .leading) {
                    Text("Workspaces").font(.headline)
                    Text("\(workspaces.count) workspace(s)").font(.caption).foregroundColor(.secondary)
                }
                Spacer()
                Button(action: { showingNewWorkspace = true }) {
                    Label("New Workspace", systemImage: "plus")
                }
            }
            .padding()
            
            Divider()
            
            if showingNewWorkspace {
                HStack {
                    TextField("Workspace Name...", text: $newName)
                        .textFieldStyle(.roundedBorder)
                    Button("Create") {
                        let w = Workspace(name: newName, isDefault: workspaces.isEmpty)
                        modelContext.insert(w)
                        try? modelContext.save()
                        newName = ""
                        showingNewWorkspace = false
                    }
                    .disabled(newName.isEmpty)
                    Button { showingNewWorkspace = false } label: { Image(systemName: "xmark") }
                        .buttonStyle(.plain)
                }
                .padding()
                .background(Color(nsColor: .controlBackgroundColor))
            }
            
            ScrollView {
                VStack(spacing: 16) {
                    if workspaces.isEmpty {
                        VStack {
                            Image(systemName: "square.grid.2x2")
                                .font(.system(size: 32))
                                .foregroundColor(.secondary.opacity(0.3))
                            Text("No workspaces yet.")
                                .foregroundColor(.secondary)
                        }
                        .padding(.top, 50)
                    } else {
                        ForEach(workspaces) { ws in
                            WorkspaceListCard(workspace: ws)
                        }
                    }
                }
                .padding()
            }
        }
        .navigationTitle("Workspaces")
    }
}

struct WorkspaceListCard: View {
    let workspace: Workspace
    @Environment(\.modelContext) private var modelContext
    @State private var newManualTag = ""
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(workspace.name).font(.headline)
                if workspace.isDefault {
                    Text("Active")
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.accentColor.opacity(0.2))
                        .foregroundColor(.accentColor)
                        .cornerRadius(8)
                }
                Spacer()
                Button(role: .destructive) {
                    modelContext.delete(workspace)
                    try? modelContext.save()
                } label: {
                    Image(systemName: "trash")
                }
            }
            
            Text("Created \(workspace.createdAt.formatted(date: .abbreviated, time: .omitted))")
                .font(.caption)
                .foregroundColor(.secondary)
            
            // Topic Signature Section (simplified for parity UI)
            Divider()
            HStack {
                Text("Workspace Context").font(.subheadline).bold()
                Spacer()
                Button("Discover Context") {
                    // Trigger Analysis
                }
                .font(.caption)
                .buttonStyle(.plain)
                .foregroundColor(.accentColor)
            }
            
            HStack {
                Text("Manual Tags:")
                    .font(.caption)
                    .foregroundColor(.secondary)
                TextField("+ Tag (Enter)", text: $newManualTag)
                    .font(.caption)
                    .textFieldStyle(.plain)
            }
        }
        .padding()
        .background(workspace.isDefault ? Color.accentColor.opacity(0.05) : Color(nsColor: .windowBackgroundColor))
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12).stroke(
                workspace.isDefault ? Color.accentColor.opacity(0.5) : Color.secondary.opacity(0.2), 
                lineWidth: 1
            )
        )
    }
}
