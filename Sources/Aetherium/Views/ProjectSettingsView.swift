import SwiftUI
import SwiftData

struct ProjectSettingsView: View {
    @Bindable var project: AetheriumProject
    @EnvironmentObject var ollamaService: OllamaService

    var body: some View {
        Form {
            Section("Project Details") {
                TextField("Title", text: $project.title)
                TextField("Description", text: $project.projectDescription, axis: .vertical)
                    .lineLimit(1...5)
            }

            Section("AI Settings") {
                Picker("Default Model", selection: Binding(
                    get: { project.defaultModelName ?? "qwen2.5:7b" },
                    set: { project.defaultModelName = $0 }
                )) {
                    ForEach(ollamaService.availableModels) { model in
                        Text(model.name).tag(model.name)
                    }
                    if ollamaService.availableModels.isEmpty {
                        Text("qwen2.5:7b").tag("qwen2.5:7b")
                    }
                }

                TextField("Project System Prompt", text: Binding(
                    get: { project.systemPrompt ?? "" },
                    set: { project.systemPrompt = $0.isEmpty ? nil : $0 }
                ), axis: .vertical)
                .lineLimit(3...10)
                .help("This prompt will be injected at the start of every chat in this project.")
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Project Settings")
        .task {
            try? await ollamaService.fetchAvailableModels()
        }
    }
}
