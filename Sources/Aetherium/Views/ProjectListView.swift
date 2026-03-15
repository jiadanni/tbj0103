import SwiftUI
import SwiftData

struct ProjectListView: View {
    @Environment(\.modelContext) private var modelContext
    let projects: [AetheriumProject]
    @Binding var selectedProject: AetheriumProject?
    @Binding var showingNewProjectSheet: Bool

    var body: some View {
        List(selection: $selectedProject) {
            ForEach(projects) { project in
                ProjectRowView(project: project)
                    .tag(project)
                    .contextMenu {
                        Button("Edit Project") {
                            // TODO: Show edit sheet
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
        NavigationStack {
            Form {
                Section("Project Details") {
                    TextField("Project Title", text: $title)
                        .textFieldStyle(.roundedBorder)

                    TextField("Description", text: $description, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(3...6)
                }

                Section {
                    Text("Projects help organize your learning goals and related conversations.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .formStyle(.grouped)
            .navigationTitle("New Project")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        createProject()
                    }
                    .disabled(title.isEmpty)
                }
            }
        }
        .frame(width: 500, height: 300)
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


