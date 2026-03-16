import SwiftUI
import SwiftData

struct ProjectSettingsView: View {
    @Bindable var project: Workspace
    @EnvironmentObject var ollamaService: OllamaService

    var body: some View {
        Form {
            Section("Workspace Details") {
                TextField("Title", text: $project.title)
                TextField("Description", text: $project.workspaceDescription, axis: .vertical)
                    .lineLimit(1...5)
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Workspace Settings")
    }
}
