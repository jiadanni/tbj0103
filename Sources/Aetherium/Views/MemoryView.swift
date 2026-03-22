import SwiftData
import SwiftUI

// MARK: - Memory View

struct MemoryView: View {
    let project: Workspace
    @Environment(\.modelContext) private var modelContext

    @Query private var memories: [Memory]

    @State private var newContent = ""
    @State private var newType: MemoryType = .fact
    @State private var submitting = false

    init(project: Workspace) {
        self.project = project
        
        let projectId = project.id
        self._memories = Query(
            filter: #Predicate<Memory> { $0.workspace?.id == projectId },
            sort: [
                SortDescriptor(\Memory.isPinned, order: .reverse),
                SortDescriptor(\Memory.updatedAt, order: .reverse)
            ]
        )
    }

    private var activeCount: Int {
        memories.filter { $0.isActive }.count
    }

    private var pinnedCount: Int {
        memories.filter { $0.isPinned }.count
    }

    var body: some View {
        HSplitView {
            // Left sidebar: input and stats
            VStack(spacing: 0) {
                // Header
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Image(systemName: "brain.head.profile").foregroundColor(.accentColor)
                        Text("Memory").font(.headline)
                    }
                    Text("Workspace-wide facts, preferences, and context the assistant can carry across chats.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                
                Divider()
                
                // Stats
                HStack(spacing: 8) {
                    StatBox(value: memories.count, label: "Total")
                    StatBox(value: activeCount, label: "Active")
                    StatBox(value: pinnedCount, label: "Pinned")
                }
                .padding()

                Divider()

                // Input Field
                VStack(spacing: 12) {
                    TextEditor(text: $newContent)
                        .font(.body)
                        .frame(height: 100)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
                        )
                        .overlay(
                            Group {
                                if newContent.isEmpty {
                                    Text("Add something worth remembering...")
                                        .foregroundColor(.secondary)
                                        .padding(.leading, 6)
                                        .padding(.top, 8)
                                        .allowsHitTesting(false)
                                }
                            },
                            alignment: .topLeading
                        )

                    Picker("Type", selection: $newType) {
                        Text("Fact").tag(MemoryType.fact)
                        Text("Preference").tag(MemoryType.preference)
                        Text("Context").tag(MemoryType.context)
                    }
                    .pickerStyle(.segmented)

                    Button(action: createMemory) {
                        HStack {
                            Image(systemName: "plus")
                            Text(submitting ? "Saving..." : "Add memory")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(submitting || newContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding()

                Spacer()
            }
            .frame(minWidth: 250, idealWidth: 300, maxWidth: 350)
            .background(Color(nsColor: .windowBackgroundColor))

            // Main view: list of memories
            ScrollView {
                if memories.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "brain.head.profile")
                            .font(.system(size: 40))
                            .foregroundColor(.secondary.opacity(0.5))
                        
                        Text("No memories yet")
                            .font(.headline)
                            .foregroundColor(.secondary)
                        
                        Text("Add durable facts or preferences here to make future chats more context-aware.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(.top, 100)
                } else {
                    LazyVStack(spacing: 12) {
                        ForEach(memories) { memory in
                            MemoryCard(memory: memory)
                                .padding(.horizontal)
                        }
                    }
                    .padding(.vertical)
                }
            }
            .frame(minWidth: 300, maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(nsColor: .controlBackgroundColor))
        }
        .navigationTitle("Memory")
    }

    private func createMemory() {
        let content = newContent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }

        submitting = true
        
        // Use a generic placeholder session ID, or "" for manual memory insertion
        let mem = Memory(
            projectId: project.id.uuidString,
            content: content,
            memoryType: newType,
            sourceSessionId: "",
            isPinned: false,
            isActive: true,
            embeddings: nil
        )
        mem.workspace = project
        modelContext.insert(mem)
        
        do {
            try modelContext.save()
            newContent = ""
            newType = .fact
        } catch {
            print("Failed to save memory: \(error)")
        }
        
        submitting = false
    }
}

// MARK: - MemoryCard

struct MemoryCard: View {
    let memory: Memory
    @Environment(\.modelContext) private var modelContext

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                // Badges
                HStack(spacing: 8) {
                    Text(memory.memoryType.rawValue.capitalized)
                        .font(.system(size: 11, weight: .medium))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.accentColor.opacity(0.15))
                        .foregroundColor(.accentColor)
                        .cornerRadius(12)

                    if memory.isPinned {
                        Text("Pinned")
                            .font(.system(size: 11, weight: .medium))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.yellow.opacity(0.15))
                            .foregroundColor(.yellow)
                            .cornerRadius(12)
                    }

                    if !memory.isActive {
                        Text("Inactive")
                            .font(.system(size: 11, weight: .medium))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.secondary.opacity(0.15))
                            .foregroundColor(.secondary)
                            .cornerRadius(12)
                    }
                }
                
                Spacer()
                
                // Actions
                HStack(spacing: 4) {
                    Button {
                        memory.isPinned.toggle()
                        memory.updatedAt = Date()
                        try? modelContext.save()
                    } label: {
                        Image(systemName: memory.isPinned ? "pin.slash.fill" : "pin")
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(.plain)
                    .help(memory.isPinned ? "Unpin memory" : "Pin memory")

                    Button {
                        memory.isActive.toggle()
                        memory.updatedAt = Date()
                        try? modelContext.save()
                    } label: {
                        Image(systemName: memory.isActive ? "eye.fill" : "eye.slash.fill")
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(.plain)
                    .help(memory.isActive ? "Deactivate memory" : "Activate memory")
                    .padding(.horizontal, 4)

                    Button {
                        modelContext.delete(memory)
                        try? modelContext.save()
                    } label: {
                        Image(systemName: "trash")
                            .foregroundColor(.red.opacity(0.8))
                    }
                    .buttonStyle(.plain)
                    .help("Delete memory")
                }
            }
            
            Text(memory.content)
                .font(.body)
                .foregroundColor(memory.isActive ? .primary : .secondary)
            
            Text("Updated \(memory.updatedAt.formatted(date: .abbreviated, time: .shortened))")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .padding()
        .background(memory.isActive ? Color(nsColor: .windowBackgroundColor) : Color(nsColor: .windowBackgroundColor).opacity(0.6))
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
        )
    }
}

// MARK: - StatBox

struct StatBox: View {
    let value: Int
    let label: String

    var body: some View {
        VStack(spacing: 4) {
            Text("\(value)")
                .font(.headline)
            Text(label.uppercased())
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(Color.secondary.opacity(0.1))
        .cornerRadius(8)
    }
}
