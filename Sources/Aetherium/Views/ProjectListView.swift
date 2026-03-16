import SwiftUI
import SwiftData

struct ProjectListView: View {
    @Environment(\.modelContext) private var modelContext
    let projects: [AetheriumProject]
    @Binding var selectedProject: AetheriumProject?
    @Binding var showingNewProjectSheet: Bool
    @State private var projectToEdit: AetheriumProject?

    var body: some View {
        List(selection: $selectedProject) {
            ForEach(projects) { project in
                ProjectRowView(project: project)
                    .tag(project)
                    .contextMenu {
                        Button("Edit Project") {
                            projectToEdit = project
                        }

                        Divider()

                        Button("Delete Project", role: .destructive) {
                            deleteProject(project)
                        }
                    }
            }
        }
        .navigationTitle("Projects")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(action: { showingNewProjectSheet = true }) {
                    Label("New Project", systemImage: "plus")
                }
            }
        }
        .sheet(item: $projectToEdit) { project in
            EditProjectSheet(project: project)
        }
    }

    private func deleteProject(_ project: AetheriumProject) {
        modelContext.delete(project)
        if selectedProject?.id == project.id {
            selectedProject = nil
        }
    }
}

struct ProjectListRowView: View {
    let project: AetheriumProject

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(project.title)
                .font(.headline)

            Text(project.projectDescription)
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

struct NewProjectSheet: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Binding var isPresented: Bool

    @State private var title = ""
    @State private var description = ""

    var body: some View {
        VStack(spacing: 20) {
            Text("New Project")
                .font(.headline)

            VStack(alignment: .leading, spacing: 12) {
                TextField("Project Title", text: $title)
                    .textFieldStyle(.roundedBorder)

                TextField("Description", text: $description, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(3...6)
            }

            Text("Projects help organize your learning goals and related conversations.")
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
        let newProject = AetheriumProject(
            title: title,
            description: description
        )
        modelContext.insert(newProject)
        dismiss()
    }
}

// MARK: - Edit Project Sheet

struct EditProjectSheet: View {
    @Environment(\.dismiss) private var dismiss

    let project: AetheriumProject

    @State private var title: String
    @State private var description: String

    init(project: AetheriumProject) {
        self.project = project
        _title = State(initialValue: project.title)
        _description = State(initialValue: project.projectDescription)
    }

    var body: some View {
        VStack(spacing: 20) {
            Text("Edit Project")
                .font(.headline)

            VStack(alignment: .leading, spacing: 12) {
                TextField("Project Title", text: $title)
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
                    project.projectDescription = description
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


