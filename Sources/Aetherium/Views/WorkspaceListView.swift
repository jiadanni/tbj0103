import SwiftUI
import SwiftData

struct WorkspaceListView: View {
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject var demoModeManager: DemoModeManager
    let projects: [Workspace]
    @Binding var selectedProject: Workspace?
    @Binding var showingNewWorkspaceSheet: Bool
    @State private var projectToEdit: Workspace?
    @State private var showingDemoAlert = false

    var body: some View {
        List(selection: $selectedProject) {
            ForEach(projects) { project in
                WorkspaceRowView(project: project)
                    .tag(project)
                    .contextMenu {
                        Button("Edit Workspace") {
                            projectToEdit = project
                        }

                        Divider()

                        Button("Delete Workspace", role: .destructive) {
                            deleteProject(project)
                        }
                    }
            }
        }
        .navigationTitle("Workspaces")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(action: { showingNewWorkspaceSheet = true }) {
                    Label("New Workspace", systemImage: "plus")
                }
            }
        }
        .sheet(item: $projectToEdit) { project in
            EditWorkspaceSheet(project: project)
        }
        .alert("Demo Mode", isPresented: $showingDemoAlert) {
            Button("OK", role: .cancel) { }
        } message: {
            Text("Deletions are disabled in demo mode. Exit demo to manage your real projects.")
        }
    }

    private func deleteProject(_ project: Workspace) {
        if demoModeManager.isActive {
            showingDemoAlert = true
            return
        }
        modelContext.delete(project)
        if selectedProject?.id == project.id {
            selectedProject = nil
        }
    }
}

struct WorkspaceListRowView: View {
    let project: Workspace

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(project.title)
                .font(.headline)

            Text(project.workspaceDescription)
                .font(.caption)
                .foregroundColor(.secondary)
                .lineLimit(2)

            HStack {
                Label("\(project.chatSessions.count)", systemImage: "message")
                Label("\(project.learningGoals.count)", systemImage: "target")
            }
            .font(.caption2)
            .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }
}

struct NewWorkspaceSheet: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Binding var isPresented: Bool

    @State private var title = ""
    @State private var description = ""

    var body: some View {
        VStack(spacing: 20) {
            Text("New Workspace")
                .font(.headline)

            VStack(alignment: .leading, spacing: 12) {
                TextField("Workspace Title", text: $title)
                    .textFieldStyle(.roundedBorder)

                TextField("Description", text: $description, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(3...6)
            }

            Text("Workspaces help organize your learning goals and related conversations.")
                .font(.caption)
                .foregroundColor(.secondary)

            HStack {
                Button("Cancel") {
                    dismiss()
                }
                .buttonStyle(.bordered)
                .keyboardShortcut(.cancelAction)

                Button("Create") {
                    createProject()
                }
                .buttonStyle(.borderedProminent)
                .disabled(title.isEmpty)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 450)
    }

    private func createProject() {
        let newProject = Workspace(
            title: title,
            description: description
        )
        modelContext.insert(newProject)
        dismiss()
    }
}

// MARK: - Edit Workspace Sheet

struct EditWorkspaceSheet: View {
    @Environment(\.dismiss) private var dismiss

    let project: Workspace

    @State private var title: String
    @State private var description: String

    init(project: Workspace) {
        self.project = project
        _title = State(initialValue: project.title)
        _description = State(initialValue: project.workspaceDescription)
    }

    var body: some View {
        VStack(spacing: 20) {
            Text("Edit Workspace")
                .font(.headline)

            VStack(alignment: .leading, spacing: 12) {
                TextField("Workspace Title", text: $title)
                    .textFieldStyle(.roundedBorder)

                TextField("Description", text: $description, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(3...6)
            }

            HStack {
                Button("Cancel") { dismiss() }
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.cancelAction)

                Button("Save") {
                    project.title = title
                    project.workspaceDescription = description
                    project.updateTimestamp()
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 450)
    }
}

