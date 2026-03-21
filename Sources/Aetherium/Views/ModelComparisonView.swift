import SwiftData
import SwiftUI

struct ModelComparisonView: View {
    let project: Workspace
    @EnvironmentObject var ollamaService: OllamaService

    @State private var modelA = ""
    @State private var modelB = ""
    @State private var prompt = ""
    @State private var responseA = ""
    @State private var responseB = ""
    @State private var isProcessing = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            // Header with model selection
            HStack {
                VStack(alignment: .leading) {
                    Text("Model A")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Picker("Model A", selection: $modelA) {
                        ForEach(ollamaService.availableModels) { model in
                            Text(model.name).tag(model.name)
                        }
                    }
                    .pickerStyle(.menu)
                }
                .frame(maxWidth: .infinity)

                Divider()

                VStack(alignment: .leading) {
                    Text("Model B")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Picker("Model B", selection: $modelB) {
                        ForEach(ollamaService.availableModels) { model in
                            Text(model.name).tag(model.name)
                        }
                    }
                    .pickerStyle(.menu)
                }
                .frame(maxWidth: .infinity)
            }
            .padding()
            .background(Color.secondary.opacity(0.05))

            Divider()

            // Responses area
            GeometryReader { geometry in
                HStack(spacing: 0) {
                    // Response A
                    ScrollView {
                        Text(responseA)
                            .padding()
                            .frame(maxWidth: .infinity, alignment: .topLeading)
                    }
                    .frame(width: geometry.size.width / 2)

                    Divider()

                    // Response B
                    ScrollView {
                        Text(responseB)
                            .padding()
                            .frame(maxWidth: .infinity, alignment: .topLeading)
                    }
                    .frame(width: geometry.size.width / 2)
                }
            }

            if isProcessing {
                HStack {
                    ProgressView()
                    Text("Processing...")
                        .foregroundColor(.secondary)
                }
                .padding()
            }

            if let error = errorMessage {
                Text(error)
                    .foregroundColor(.red)
                    .padding()
            }

            Divider()

            // Input area
            HStack {
                TextField("Enter prompt to compare models...", text: $prompt, axis: .vertical)
                    .textFieldStyle(.plain)
                    .padding(12)
                    .background(Color.secondary.opacity(0.1))
                    .cornerRadius(8)
                    .lineLimit(1...5)

                Button(action: sendPrompt) {
                    Image(systemName: "paperplane.fill")
                        .font(.title2)
                        .foregroundColor(prompt.isEmpty || isProcessing ? .gray : .blue)
                }
                .buttonStyle(.plain)
                .disabled(prompt.isEmpty || isProcessing)
            }
            .padding()
        }
        .navigationTitle("Model Comparison")
        .task {
            try? await ollamaService.fetchAvailableModels()
            if let first = ollamaService.availableModels.first {
                modelA = first.name
            }
            if ollamaService.availableModels.count > 1 {
                modelB = ollamaService.availableModels[1].name
            } else if let first = ollamaService.availableModels.first {
                modelB = first.name
            }
        }
    }

    private func sendPrompt() {
        let currentPrompt = prompt
        prompt = ""
        responseA = ""
        responseB = ""
        errorMessage = nil
        isProcessing = true

        Task {
            do {
                async let resA = ollamaService.sendMessage(currentPrompt, model: modelA)
                async let resB = ollamaService.sendMessage(currentPrompt, model: modelB)

                let (resultA, resultB) = try await (resA, resB)
                responseA = resultA
                responseB = resultB
            } catch {
                errorMessage = error.localizedDescription
            }
            isProcessing = false
        }
    }
}
