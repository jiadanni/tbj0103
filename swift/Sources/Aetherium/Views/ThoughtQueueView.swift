import SwiftData
import SwiftUI

// MARK: - Thought Queue View

struct ThoughtQueueView: View {
    let project: Workspace
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject var ollamaService: OllamaService
    @ObservedObject private var settings = AppSettings.shared

    @Query private var thoughts: [ThoughtQueueItem]

    @State private var draftContent = ""
    @State private var draftPromptPrefix = ""
    @State private var draftModel = ""
    @State private var scheduleEnabled = false
    @State private var draftSchedule: Date = Date().addingTimeInterval(3600)
    @State private var submitting = false
    @State private var expandedIds: Set<UUID> = []

    init(project: Workspace) {
        self.project = project
        self.draftModel = AppSettings.shared.preferredModel
        
        let projectId = project.id
        self._thoughts = Query(
            filter: #Predicate<ThoughtQueueItem> { $0.workspace?.id == projectId },
            sort: [SortDescriptor(\ThoughtQueueItem.updatedAt, order: .reverse)]
        )
    }

    var pendingCount: Int { thoughts.filter { $0.status == .pending }.count }
    var scheduledCount: Int { thoughts.filter { $0.status == .scheduled }.count }
    var processingCount: Int { thoughts.filter { $0.status == .processing }.count }
    var doneCount: Int { thoughts.filter { $0.status == .done }.count }

    var body: some View {
        HSplitView {
            // Left sidebar: input
            VStack(spacing: 0) {
                // Header
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Image(systemName: "tray.fill").foregroundColor(.accentColor)
                        Text("Thought Queue").font(.headline)
                    }
                    Text("Dump ideas. Schedule AI to process them later.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                
                Divider()
                
                // Form
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Thought / idea").font(.caption).foregroundColor(.secondary)
                            TextEditor(text: $draftContent)
                                .font(.body)
                                .frame(height: 120)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.2), lineWidth: 1)
                                )
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            Text("AI instruction (optional)").font(.caption).foregroundColor(.secondary)
                            TextField("e.g. Summarise this idea", text: $draftPromptPrefix)
                                .textFieldStyle(.roundedBorder)
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Model").font(.caption).foregroundColor(.secondary)
                            TextField("Model name", text: $draftModel)
                                .textFieldStyle(.roundedBorder)
                        }

                        Toggle("Schedule for later", isOn: $scheduleEnabled)
                            .font(.caption)
                            .toggleStyle(.checkbox)

                        if scheduleEnabled {
                            DatePicker("Process at", selection: $draftSchedule, in: Date()...)
                                .labelsHidden()
                                .datePickerStyle(.compact)
                        }

                        Button(action: submitThought) {
                            HStack {
                                Image(systemName: "plus")
                                Text(scheduleEnabled ? "Schedule thought" : "Add thought")
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(submitting || draftContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    .padding()
                }

                Divider()
                
                // Stats
                HStack(spacing: 4) {
                    StatBoxTQ(value: pendingCount, label: "PENDING", color: .secondary)
                    StatBoxTQ(value: scheduledCount, label: "SCHEDULED", color: .blue)
                    StatBoxTQ(value: processingCount, label: "RUNNING", color: .orange)
                    StatBoxTQ(value: doneCount, label: "DONE", color: .green)
                }
                .padding(8)
            }
            .frame(minWidth: 280, idealWidth: 320, maxWidth: 350)
            .background(Color(nsColor: .windowBackgroundColor))

            // Main view: list of thoughts
            ScrollView {
                if thoughts.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "tray")
                            .font(.system(size: 40))
                            .foregroundColor(.secondary.opacity(0.3))
                        Text("Your thought queue is empty.")
                            .font(.headline)
                            .foregroundColor(.secondary)
                        Text("Add a thought on the left to get started.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(.top, 100)
                } else {
                    LazyVStack(spacing: 12) {
                        let ordered = thoughts.sorted { t1, t2 in
                            // processing > scheduled > pending > done
                            let order = { (s: ThoughtStatus) -> Int in
                                switch s {
                                case .processing: return 0
                                case .scheduled: return 1
                                case .pending: return 2
                                case .done: return 3
                                }
                            }
                            let s1 = order(t1.status)
                            let s2 = order(t2.status)
                            if s1 == s2 { return t1.createdAt > t2.createdAt }
                            return s1 < s2
                        }

                        ForEach(ordered) { thought in
                            ThoughtCardView(
                                thought: thought,
                                isExpanded: expandedIds.contains(thought.id),
                                onProcessNow: { processNow(thought) },
                                onToggleExpand: {
                                    if expandedIds.contains(thought.id) {
                                        expandedIds.remove(thought.id)
                                    } else {
                                        expandedIds.insert(thought.id)
                                    }
                                }
                            )
                            .padding(.horizontal)
                        }
                    }
                    .padding(.vertical)
                }
            }
            .frame(minWidth: 300, maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(nsColor: .controlBackgroundColor))
        }
        .navigationTitle("Thought Queue")
        .task {
            // Passive background processing loop
            for await _ in Timer.publish(every: 60, on: .main, in: .common).autoconnect().values {
                processDueThoughts()
            }
        }
        .task {
            // Initial run on appear
            processDueThoughts()
        }
    }

    private func submitThought() {
        let content = draftContent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }

        submitting = true
        let t = ThoughtQueueItem(
            content: content,
            status: scheduleEnabled ? .scheduled : .pending,
            processAt: scheduleEnabled ? draftSchedule : nil,
            promptPrefix: draftPromptPrefix.trimmingCharacters(in: .whitespacesAndNewlines),
            modelName: draftModel,
            result: nil,
            resultAt: nil
        )
        t.workspace = project
        modelContext.insert(t)
        try? modelContext.save()

        draftContent = ""
        draftPromptPrefix = ""
        scheduleEnabled = false
        submitting = false
    }

    private func processNow(_ thought: ThoughtQueueItem) {
        if thought.status == .processing { return }
        thought.status = .scheduled
        try? modelContext.save()
        processDueThoughts()
    }

    private func processDueThoughts() {
        let now = Date()
        for t in thoughts where (t.status == .scheduled && (t.processAt ?? .distantPast) <= now) || t.status == .pending {
            Task {
                await runOllamaTask(for: t)
            }
        }
    }

    private func runOllamaTask(for thought: ThoughtQueueItem) async {
        guard thought.status != .processing && thought.status != .done else { return }
        
        // Mark as processing
        await MainActor.run {
            thought.status = .processing
            thought.updatedAt = Date()
            try? modelContext.save()
        }

        let prefix = thought.promptPrefix?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let userContent = prefix.isEmpty ? thought.content : "\(prefix)\n\n\(thought.content)"

        do {
            let messages = [Message(role: .user, content: userContent)]
            let stream = ollamaService.sendMessage(messages: messages, modelOverride: thought.modelName, systemPrompt: nil)
            
            var fullResponse = ""
            for try await chunk in stream {
                fullResponse += chunk
            }

            // Save result
            await MainActor.run {
                thought.result = fullResponse
                thought.status = .done
                thought.resultAt = Date()
                thought.updatedAt = Date()
                expandedIds.insert(thought.id)
                try? modelContext.save()
            }
        } catch {
            print("ThoughtQueue generation failed: \(error)")
            // Revert on failure
            await MainActor.run {
                thought.status = .scheduled
                try? modelContext.save()
            }
        }
    }
}

// MARK: - Subcomponents

struct StatBoxTQ: View {
    let value: Int
    let label: String
    let color: Color

    var body: some View {
        VStack(spacing: 4) {
            Text("\(value)")
                .font(.headline)
                .foregroundColor(color)
            Text(label)
                .font(.system(size: 8, weight: .bold))
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(Color.secondary.opacity(0.1))
        .cornerRadius(6)
    }
}

struct ThoughtCardView: View {
    let thought: ThoughtQueueItem
    let isExpanded: Bool
    let onProcessNow: () -> Void
    let onToggleExpand: () -> Void
    @Environment(\.modelContext) private var modelContext

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                // Main Content
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        StatusBadge(status: thought.status)
                        
                        if let date = thought.processAt, thought.status != .done {
                            HStack(spacing: 2) {
                                Image(systemName: "calendar")
                                Text(date.formatted())
                            }
                            .font(.system(size: 10))
                            .foregroundColor(.secondary)
                        }
                        
                        Spacer()
                        
                        Text(thought.createdAt.formatted(date: .abbreviated, time: .shortened))
                            .font(.system(size: 10))
                            .foregroundColor(.secondary)
                    }

                    Text(thought.content)
                        .font(.body)
                        .lineLimit(nil)

                    if let p = thought.promptPrefix, !p.isEmpty {
                        Text("Instruction: \(p)")
                            .font(.caption)
                            .italic()
                            .foregroundColor(.secondary)
                    }

                    Text(thought.modelName)
                        .font(.system(size: 10))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.secondary.opacity(0.2))
                        .cornerRadius(4)
                }

                // Actions
                HStack(spacing: 8) {
                    if thought.status == .pending || thought.status == .scheduled {
                        Button(action: onProcessNow) { Image(systemName: "bolt.fill") }
                            .buttonStyle(.plain)
                            .foregroundColor(.secondary)
                            .help("Process Now")
                    }
                    if thought.status == .processing {
                        ProgressView().controlSize(.small)
                            .padding(.horizontal, 4)
                    }
                    if thought.result != nil {
                        Button(action: onToggleExpand) {
                            Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        }
                        .buttonStyle(.plain)
                        .foregroundColor(.secondary)
                        .help(isExpanded ? "Collapse" : "Show Result")
                    }
                    Button(action: { modelContext.delete(thought); try? modelContext.save() }) {
                        Image(systemName: "trash")
                            .foregroundColor(.red.opacity(0.8))
                    }
                    .buttonStyle(.plain)
                    .help("Delete Thought")
                }
            }
            .padding()

            if isExpanded, let result = thought.result {
                Divider()
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill").foregroundColor(.green)
                        Text("AI Response")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    Text(result)
                        .font(.body)
                        .lineLimit(nil)
                }
                .padding()
                .background(Color.green.opacity(0.05))
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .cornerRadius(12)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.secondary.opacity(0.2), lineWidth: 1))
    }
}

struct StatusBadge: View {
    let status: ThoughtStatus

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: iconName)
            Text(status.rawValue.lowercased())
        }
        .font(.system(size: 10, weight: .medium))
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(bgColor)
        .foregroundColor(fgColor)
        .cornerRadius(12)
    }

    var iconName: String {
        switch status {
        case .pending: return "tray.fill"
        case .scheduled: return "clock.fill"
        case .processing: return "arrow.triangle.2.circlepath" // Using a built-in symbol
        case .done: return "checkmark.circle.fill"
        }
    }

    var fgColor: Color {
        switch status {
        case .pending: return .secondary
        case .scheduled: return .blue
        case .processing: return .orange
        case .done: return .green
        }
    }

    var bgColor: Color {
        fgColor.opacity(0.15)
    }
}
