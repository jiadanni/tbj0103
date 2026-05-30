import SwiftData
import SwiftUI

// MARK: - GlobalMemoryView
// App-wide memories not scoped to any workspace.
// Mirrors Tauri GlobalMemoryView + global memory summary + snapshot rollback.

struct GlobalMemoryView: View {
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject private var ollamaService: OllamaService

    @Query(
        filter: #Predicate<Memory> { $0.workspace == nil },
        sort: [
            SortDescriptor(\Memory.isPinned, order: .reverse),
            SortDescriptor(\Memory.updatedAt, order: .reverse)
        ]
    )
    private var globalMemories: [Memory]

    @Query(
        filter: #Predicate<MemorySummary> { $0.isGlobal == true },
        sort: [SortDescriptor(\MemorySummary.updatedAt, order: .reverse)]
    )
    private var summaries: [MemorySummary]

    @State private var newContent = ""
    @State private var newType: MemoryType = .fact
    @State private var selectedTab: GlobalMemoryTab = .memories
    @State private var editingSummary = false
    @State private var editSummaryText = ""
    @State private var selectedSnapshot: MemorySummarySnapshot?
    @State private var showingSnapshotRollback = false

    private var activeSummary: MemorySummary? { summaries.first }

    var body: some View {
        HSplitView {
            // Left: input + stats
            leftPanel

            // Right: tabbed content
            VStack(spacing: 0) {
                Picker("", selection: $selectedTab) {
                    ForEach(GlobalMemoryTab.allCases) { tab in
                        Text(tab.label).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .padding()

                Divider()

                switch selectedTab {
                case .memories:
                    memoriesPanel
                case .summary:
                    summaryPanel
                case .snapshots:
                    snapshotsPanel
                }
            }
        }
        .navigationTitle("Global Memory")
        .alert("Rollback Summary?", isPresented: $showingSnapshotRollback) {
            Button("Cancel", role: .cancel) { selectedSnapshot = nil }
            Button("Rollback", role: .destructive) {
                if let snap = selectedSnapshot {
                    rollbackToSnapshot(snap)
                }
                selectedSnapshot = nil
            }
        } message: {
            if let snap = selectedSnapshot {
                Text("Restore the summary from \(snap.snapshotAt.formatted(.relative(presentation: .named)))?")
            }
        }
    }

    // MARK: - Left panel

    private var leftPanel: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Image(systemName: "brain").foregroundColor(.purple)
                    Text("Global Memory").font(.headline)
                }
                Text("Facts and preferences that apply across all workspaces.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)

            Divider()

            // Stats
            HStack(spacing: 8) {
                StatBox(value: globalMemories.count, label: "Total")
                StatBox(value: globalMemories.filter { $0.isActive }.count, label: "Active")
                StatBox(value: globalMemories.filter { $0.isPinned }.count, label: "Pinned")
            }
            .padding()

            Divider()

            // Input
            VStack(spacing: 12) {
                TextEditor(text: $newContent)
                    .font(.body)
                    .frame(height: 90)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
                    )
                    .overlay(
                        Group {
                            if newContent.isEmpty {
                                Text("Add a global fact or preference…")
                                    .foregroundColor(.secondary)
                                    .padding(.leading, 6)
                                    .padding(.top, 8)
                                    .allowsHitTesting(false)
                            }
                        },
                        alignment: .topLeading
                    )

                Picker("Type", selection: $newType) {
                    ForEach(MemoryType.allCases, id: \.self) { t in
                        Text(t.displayName).tag(t)
                    }
                }
                .pickerStyle(.segmented)

                Button("Add Memory") {
                    addMemory()
                }
                .buttonStyle(.borderedProminent)
                .disabled(newContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .frame(maxWidth: .infinity)
            }
            .padding()

            Spacer()
        }
        .frame(minWidth: 240, maxWidth: 300)
    }

    // MARK: - Memories panel

    private var memoriesPanel: some View {
        Group {
            if globalMemories.isEmpty {
                ContentUnavailableView(
                    "No Global Memories",
                    systemImage: "brain",
                    description: Text("Add facts or preferences that apply across all workspaces.")
                )
            } else {
                List {
                    ForEach(globalMemories) { memory in
                        GlobalMemoryRow(memory: memory, onDelete: { deleteMemory(memory) })
                    }
                }
                .listStyle(.plain)
            }
        }
    }

    // MARK: - Summary panel

    private var summaryPanel: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("Memory Summary")
                        .font(.headline)
                    Spacer()
                    Button("Regenerate") {
                        Task { await regenerateSummary() }
                    }
                    .font(.caption)
                    Button(editingSummary ? "Done" : "Edit") {
                        if editingSummary, let summary = activeSummary {
                            snapshotCurrentSummary(summary)
                            summary.content = editSummaryText
                            summary.updateTimestamp()
                            try? modelContext.save()
                        } else {
                            editSummaryText = activeSummary?.content ?? ""
                        }
                        editingSummary.toggle()
                    }
                    .font(.caption)
                }

                if let summary = activeSummary {
                    if editingSummary {
                        TextEditor(text: $editSummaryText)
                            .font(.body)
                            .frame(minHeight: 200)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
                            )
                    } else {
                        Text(summary.content)
                            .font(.body)
                    }

                    Text("Updated \(summary.updatedAt.formatted(.relative(presentation: .named)))")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                } else {
                    ContentUnavailableView(
                        "No Summary Yet",
                        systemImage: "doc.text",
                        description: Text("Tap Regenerate to create a summary of your global memories.")
                    )
                }
            }
            .padding()
        }
    }

    // MARK: - Snapshots panel

    private var snapshotsPanel: some View {
        Group {
            let allSnapshots = summaries.flatMap { $0.snapshots }.sorted { $0.snapshotAt > $1.snapshotAt }
            if allSnapshots.isEmpty {
                ContentUnavailableView(
                    "No Snapshots",
                    systemImage: "clock.arrow.circlepath",
                    description: Text("Snapshot history is saved whenever you edit the summary.")
                )
            } else {
                List(allSnapshots) { snap in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(snap.snapshotAt.formatted(date: .abbreviated, time: .shortened))
                            .font(.caption.bold())
                            .foregroundColor(.secondary)
                        Text(snap.content)
                            .font(.caption)
                            .lineLimit(3)
                            .foregroundColor(.primary)
                    }
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        selectedSnapshot = snap
                        showingSnapshotRollback = true
                    }
                }
                .listStyle(.plain)
            }
        }
    }

    // MARK: - Actions

    private func addMemory() {
        let memory = Memory(
            content: newContent.trimmingCharacters(in: .whitespacesAndNewlines),
            memoryType: newType
        )
        // workspace = nil → global
        modelContext.insert(memory)
        try? modelContext.save()
        newContent = ""
    }

    private func deleteMemory(_ memory: Memory) {
        modelContext.delete(memory)
        try? modelContext.save()
    }

    private func regenerateSummary() async {
        let combined = globalMemories
            .filter { $0.isActive }
            .map { "[\($0.type.displayName)] \($0.content)" }
            .joined(separator: "\n")

        guard !combined.isEmpty else { return }

        if let existing = activeSummary {
            snapshotCurrentSummary(existing)
            existing.content = "(Regenerating…)"
            existing.updateTimestamp()
        } else {
            let newSummary = MemorySummary(content: "(Regenerating…)", isGlobal: true)
            modelContext.insert(newSummary)
        }
        try? modelContext.save()

        let prompt = "Summarize these global memory items concisely:\n\n\(combined)"
        do {
            let text = try await ollamaService.generateText(prompt: prompt)
            if let existing = activeSummary {
                existing.content = text
                existing.updateTimestamp()
                try? modelContext.save()
            }
        } catch {
            // Leave "(Regenerating…)" text as an indicator that it failed
        }
    }

    private func snapshotCurrentSummary(_ summary: MemorySummary) {
        guard !summary.content.isEmpty, summary.content != "(Regenerating…)" else { return }
        let snap = MemorySummarySnapshot(content: summary.content, summary: summary)
        modelContext.insert(snap)
    }

    private func rollbackToSnapshot(_ snapshot: MemorySummarySnapshot) {
        guard let summary = snapshot.summary ?? activeSummary else { return }
        snapshotCurrentSummary(summary)
        summary.content = snapshot.content
        summary.updateTimestamp()
        try? modelContext.save()
    }
}

// MARK: - GlobalMemoryRow

private struct GlobalMemoryRow: View {
    let memory: Memory
    let onDelete: () -> Void
    @Environment(\.modelContext) private var modelContext

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: memory.isPinned ? "pin.fill" : "circle.fill")
                    .foregroundColor(typeColor(memory.type))
                    .font(.caption)

                Text(memory.type.displayName)
                    .font(.caption2.bold())
                    .foregroundColor(typeColor(memory.type))

                Spacer()

                Toggle("Active", isOn: Binding(
                    get: { memory.isActive },
                    set: {
                        memory.isActive = $0
                        memory.updatedAt = Date()
                        try? modelContext.save()
                    }
                ))
                .toggleStyle(.switch)
                .labelsHidden()
                .scaleEffect(0.75)
            }

            Text(memory.content)
                .font(.body)

            Text(memory.createdAt.formatted(date: .abbreviated, time: .omitted))
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
        .swipeActions(edge: .leading) {
            Button {
                memory.isPinned.toggle()
                memory.updatedAt = Date()
                try? modelContext.save()
            } label: {
                Label(memory.isPinned ? "Unpin" : "Pin", systemImage: memory.isPinned ? "pin.slash" : "pin")
            }
            .tint(.orange)
        }
        .swipeActions(edge: .trailing) {
            Button(role: .destructive, action: onDelete) {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    private func typeColor(_ type: MemoryType) -> Color {
        switch type {
        case .fact: return .blue
        case .preference: return .purple
        case .context: return .orange
        }
    }
}

// MARK: - Helpers

enum GlobalMemoryTab: String, CaseIterable, Identifiable {
    case memories, summary, snapshots
    var id: String { rawValue }
    var label: String {
        switch self {
        case .memories: return "Memories"
        case .summary: return "Summary"
        case .snapshots: return "History"
        }
    }
}

private struct StatBox: View {
    let value: Int
    let label: String

    var body: some View {
        VStack(spacing: 4) {
            Text("\(value)")
                .font(.title2.bold())
                .monospacedDigit()
            Text(label)
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(Color(nsColor: .controlBackgroundColor))
        .cornerRadius(8)
    }
}

// MARK: - MemoryType additions

extension MemoryType: CaseIterable {
    var displayName: String {
        switch self {
        case .fact: return "Fact"
        case .preference: return "Preference"
        case .context: return "Context"
        }
    }
}
