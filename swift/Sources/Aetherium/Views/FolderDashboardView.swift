import SwiftData
import SwiftUI

// MARK: - FolderDashboardView
// Mirrors Tauri FolderDashboardView: shows folder-level metrics, recent chat
// sessions, and provides CRUD for folders within a workspace.

struct FolderDashboardView: View {
    let workspace: Workspace
    @Environment(\.modelContext) private var modelContext

    @State private var showingNewFolder = false
    @State private var selectedFolder: Folder?
    @State private var folderToEdit: Folder?

    private var folders: [Folder] {
        workspace.folders.sorted {
            if $0.sortOrder == $1.sortOrder {
                return $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
            }
            return $0.sortOrder < $1.sortOrder
        }
    }

    var body: some View {
        NavigationSplitView {
            folderSidebar
        } detail: {
            if let folder = selectedFolder {
                FolderDetailView(folder: folder, workspace: workspace)
            } else {
                workspaceOverview
            }
        }
        .navigationTitle("Folders")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(action: { showingNewFolder = true }) {
                    Label("New Folder", systemImage: "folder.badge.plus")
                }
            }
        }
        .sheet(isPresented: $showingNewFolder) {
            NewFolderSheet(workspace: workspace)
        }
        .sheet(item: $folderToEdit) { folder in
            EditFolderSheet(folder: folder)
        }
    }

    // MARK: - Sidebar

    private var folderSidebar: some View {
        List(selection: $selectedFolder) {
            Section("Workspace Overview") {
                Label("All Chats", systemImage: "tray.2.fill")
                    .tag(Folder?.none)
            }

            Section("Folders (\(folders.count))") {
                ForEach(folders) { folder in
                    FolderRow(folder: folder)
                        .tag(Optional(folder))
                        .contextMenu {
                            Button("Edit") { folderToEdit = folder }
                            Divider()
                            Button("Delete", role: .destructive) { deleteFolder(folder) }
                        }
                }
            }
        }
        .listStyle(.sidebar)
    }

    // MARK: - Workspace overview card grid

    private var workspaceOverview: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text(workspace.title)
                    .font(.largeTitle.bold())
                    .padding(.horizontal)

                // Metric cards
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 160))], spacing: 16) {
                    MetricCard(
                        icon: "folder.fill",
                        label: "Folders",
                        value: "\(workspace.folders.count)",
                        color: .blue
                    )
                    MetricCard(
                        icon: "message.fill",
                        label: "Chats",
                        value: "\(workspace.chatSessions.count)",
                        color: .indigo
                    )
                    MetricCard(
                        icon: "brain.head.profile",
                        label: "Concepts",
                        value: "\(workspace.concepts.count)",
                        color: .purple
                    )
                    MetricCard(
                        icon: "doc.text.fill",
                        label: "Sources",
                        value: "\(workspace.sources.count)",
                        color: .orange
                    )
                    MetricCard(
                        icon: "rectangle.stack.fill",
                        label: "Flashcards",
                        value: "\(workspace.learningCards.count)",
                        color: .green
                    )
                    MetricCard(
                        icon: "target",
                        label: "Goals",
                        value: "\(workspace.learningGoals.count)",
                        color: .red
                    )
                }
                .padding(.horizontal)

                // Recent chat sessions (last 10)
                if !recentSessions.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Recent Activity")
                            .font(.headline)
                            .padding(.horizontal)

                        ForEach(recentSessions) { session in
                            RecentSessionRow(session: session)
                        }
                    }
                }
            }
            .padding(.vertical)
        }
    }

    private var recentSessions: [ChatSession] {
        workspace.chatSessions
            .sorted { lhs, rhs in
                (lhs.updatedAt ?? lhs.createdAt) > (rhs.updatedAt ?? rhs.createdAt)
            }
            .prefix(10)
            .map { $0 }
    }

    private func deleteFolder(_ folder: Folder) {
        modelContext.delete(folder)
        if selectedFolder?.id == folder.id {
            selectedFolder = nil
        }
        try? modelContext.save()
    }
}

// MARK: - FolderDetailView

private struct FolderDetailView: View {
    let folder: Folder
    let workspace: Workspace

    private var sessions: [ChatSession] {
        folder.chatSessions.sorted {
            ($0.updatedAt ?? $0.createdAt) > ($1.updatedAt ?? $1.createdAt)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Folder header
                HStack(spacing: 12) {
                    Image(systemName: folder.iconName)
                        .font(.system(size: 28))
                        .foregroundColor(Color(hex: folder.colorHex) ?? .accentColor)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(folder.title)
                            .font(.title2.bold())
                        if !folder.folderDescription.isEmpty {
                            Text(folder.folderDescription)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }
                .padding(.horizontal)

                // Quick stats
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 140))], spacing: 12) {
                    MetricCard(
                        icon: "message.fill",
                        label: "Chats",
                        value: "\(folder.chatSessions.count)",
                        color: .indigo
                    )
                }
                .padding(.horizontal)

                // Custom instructions preview
                if !folder.customInstructions.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Custom Instructions", systemImage: "text.quote")
                            .font(.headline)
                        Text(folder.customInstructions)
                            .font(.body)
                            .foregroundColor(.secondary)
                            .padding()
                            .background(Color(nsColor: .controlBackgroundColor))
                            .cornerRadius(8)
                    }
                    .padding(.horizontal)
                }

                // Sessions
                if sessions.isEmpty {
                    ContentUnavailableView(
                        "No Chats Yet",
                        systemImage: "message",
                        description: Text("Assign chat sessions to this folder from the chat view.")
                    )
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Chat Sessions")
                            .font(.headline)
                            .padding(.horizontal)

                        ForEach(sessions) { session in
                            RecentSessionRow(session: session)
                        }
                    }
                }
            }
            .padding(.vertical)
        }
    }
}

// MARK: - Supporting sub-views

private struct FolderRow: View {
    let folder: Folder

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: folder.iconName)
                .foregroundColor(Color(hex: folder.colorHex) ?? .accentColor)
                .frame(width: 20)

            VStack(alignment: .leading, spacing: 2) {
                Text(folder.title)
                    .font(.body)

                Text("\(folder.chatSessions.count) chats")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

private struct MetricCard: View {
    let icon: String
    let label: String
    let value: String
    let color: Color

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 22))
                .foregroundColor(color)

            Text(value)
                .font(.title2.bold())

            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(color.opacity(0.08))
        .cornerRadius(12)
    }
}

private struct RecentSessionRow: View {
    let session: ChatSession

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "message.circle.fill")
                .foregroundColor(.accentColor)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 2) {
                Text(session.title.isEmpty ? "Untitled Chat" : session.title)
                    .font(.body)
                    .lineLimit(1)

                if let updated = session.updatedAt ?? session.createdAt as Date? {
                    Text(updated.formatted(.relative(presentation: .named)))
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()
        }
        .padding(.horizontal)
        .padding(.vertical, 6)
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.5))
        .cornerRadius(8)
        .padding(.horizontal)
    }
}

// MARK: - NewFolderSheet

struct NewFolderSheet: View {
    let workspace: Workspace
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var description = ""
    @State private var colorHex = "#6B7280"
    @State private var iconName = "folder.fill"
    @State private var customInstructions = ""

    private let iconOptions = [
        "folder.fill", "archivebox.fill", "tray.2.fill", "tray.fill",
        "books.vertical.fill", "graduationcap.fill", "star.fill",
        "bolt.fill", "flame.fill", "brain.head.profile", "lightbulb.fill"
    ]

    private let colorOptions = [
        "#6B7280", "#3B82F6", "#8B5CF6", "#EC4899",
        "#EF4444", "#F97316", "#EAB308", "#22C55E", "#14B8A6"
    ]

    var body: some View {
        VStack(spacing: 20) {
            Text("New Folder")
                .font(.headline)

            VStack(alignment: .leading, spacing: 14) {
                TextField("Folder Name", text: $title)
                    .textFieldStyle(.roundedBorder)

                TextField("Description (optional)", text: $description, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(2...4)

                // Icon picker
                VStack(alignment: .leading, spacing: 6) {
                    Text("Icon").font(.caption).foregroundColor(.secondary)
                    LazyVGrid(columns: Array(repeating: GridItem(.fixed(36)), count: 11), spacing: 8) {
                        ForEach(iconOptions, id: \.self) { icon in
                            Image(systemName: icon)
                                .font(.system(size: 16))
                                .frame(width: 32, height: 32)
                                .background(iconName == icon ? Color.accentColor.opacity(0.2) : Color.clear)
                                .cornerRadius(6)
                                .onTapGesture { iconName = icon }
                        }
                    }
                }

                // Color picker
                VStack(alignment: .leading, spacing: 6) {
                    Text("Color").font(.caption).foregroundColor(.secondary)
                    HStack(spacing: 8) {
                        ForEach(colorOptions, id: \.self) { hex in
                            Circle()
                                .fill(Color(hex: hex) ?? .gray)
                                .frame(width: 22, height: 22)
                                .overlay(
                                    Circle()
                                        .stroke(Color.primary, lineWidth: colorHex == hex ? 2 : 0)
                                        .padding(-2)
                                )
                                .onTapGesture { colorHex = hex }
                        }
                    }
                }

                TextField("Custom Instructions (optional)", text: $customInstructions, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(3...6)
            }

            HStack {
                Button("Cancel") { dismiss() }
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.cancelAction)

                Button("Create") { createFolder() }
                    .buttonStyle(.borderedProminent)
                    .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 460)
    }

    private func createFolder() {
        let nextOrder = (workspace.folders.map(\.sortOrder).max() ?? -1) + 1
        let folder = Folder(
            title: title,
            description: description,
            colorHex: colorHex,
            iconName: iconName,
            customInstructions: customInstructions,
            sortOrder: nextOrder
        )
        folder.workspace = workspace
        modelContext.insert(folder)
        try? modelContext.save()
        dismiss()
    }
}

// MARK: - EditFolderSheet

struct EditFolderSheet: View {
    let folder: Folder
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var title: String
    @State private var description: String
    @State private var colorHex: String
    @State private var iconName: String
    @State private var customInstructions: String

    private let iconOptions = [
        "folder.fill", "archivebox.fill", "tray.2.fill", "tray.fill",
        "books.vertical.fill", "graduationcap.fill", "star.fill",
        "bolt.fill", "flame.fill", "brain.head.profile", "lightbulb.fill"
    ]

    private let colorOptions = [
        "#6B7280", "#3B82F6", "#8B5CF6", "#EC4899",
        "#EF4444", "#F97316", "#EAB308", "#22C55E", "#14B8A6"
    ]

    init(folder: Folder) {
        self.folder = folder
        _title = State(initialValue: folder.title)
        _description = State(initialValue: folder.folderDescription)
        _colorHex = State(initialValue: folder.colorHex)
        _iconName = State(initialValue: folder.iconName)
        _customInstructions = State(initialValue: folder.customInstructions)
    }

    var body: some View {
        VStack(spacing: 20) {
            Text("Edit Folder")
                .font(.headline)

            VStack(alignment: .leading, spacing: 14) {
                TextField("Folder Name", text: $title)
                    .textFieldStyle(.roundedBorder)

                TextField("Description (optional)", text: $description, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(2...4)

                // Icon picker
                VStack(alignment: .leading, spacing: 6) {
                    Text("Icon").font(.caption).foregroundColor(.secondary)
                    LazyVGrid(columns: Array(repeating: GridItem(.fixed(36)), count: 11), spacing: 8) {
                        ForEach(iconOptions, id: \.self) { icon in
                            Image(systemName: icon)
                                .font(.system(size: 16))
                                .frame(width: 32, height: 32)
                                .background(iconName == icon ? Color.accentColor.opacity(0.2) : Color.clear)
                                .cornerRadius(6)
                                .onTapGesture { iconName = icon }
                        }
                    }
                }

                // Color picker
                VStack(alignment: .leading, spacing: 6) {
                    Text("Color").font(.caption).foregroundColor(.secondary)
                    HStack(spacing: 8) {
                        ForEach(colorOptions, id: \.self) { hex in
                            Circle()
                                .fill(Color(hex: hex) ?? .gray)
                                .frame(width: 22, height: 22)
                                .overlay(
                                    Circle()
                                        .stroke(Color.primary, lineWidth: colorHex == hex ? 2 : 0)
                                        .padding(-2)
                                )
                                .onTapGesture { colorHex = hex }
                        }
                    }
                }

                TextField("Custom Instructions (optional)", text: $customInstructions, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(3...6)
            }

            HStack {
                Button("Cancel") { dismiss() }
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.cancelAction)

                Button("Save") { save() }
                    .buttonStyle(.borderedProminent)
                    .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 460)
    }

    private func save() {
        folder.title = title
        folder.folderDescription = description
        folder.colorHex = colorHex
        folder.iconName = iconName
        folder.customInstructions = customInstructions
        folder.updateTimestamp()
        try? modelContext.save()
        dismiss()
    }
}

// MARK: - Color(hex:) helper extension

private extension Color {
    init?(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        guard hex.count == 6, Scanner(string: hex).scanHexInt64(&int) else { return nil }
        let r = Double((int >> 16) & 0xFF) / 255
        let g = Double((int >> 8) & 0xFF) / 255
        let b = Double(int & 0xFF) / 255
        self.init(red: r, green: g, blue: b)
    }
}
