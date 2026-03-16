import SwiftUI

struct BackupTimelineView: View {
    @EnvironmentObject var backupService: BackupService

    @State private var expandedEntryID: UUID?
    @State private var entryToRestore: BackupEntry?
    @State private var showRestoreConfirmation = false
    @State private var restoreError: String?

    var body: some View {
        VStack(spacing: 0) {
            // Header
            headerView

            Divider()

            // Timeline
            if backupService.manifest.entries.isEmpty {
                ContentUnavailableView(
                    "No Backups Yet",
                    systemImage: "clock.arrow.circlepath",
                    description: Text("Click \"Backup Now\" to create your first snapshot.")
                )
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(backupService.manifest.entries.reversed()) { entry in
                            TimelineEntryRow(
                                entry: entry,
                                isExpanded: expandedEntryID == entry.id,
                                onToggle: {
                                    withAnimation(.easeInOut(duration: 0.2)) {
                                        expandedEntryID = expandedEntryID == entry.id ? nil : entry.id
                                    }
                                },
                                onRestore: {
                                    entryToRestore = entry
                                    showRestoreConfirmation = true
                                }
                            )
                        }
                    }
                    .padding()
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .confirmationDialog(
            "Restore from Backup?",
            isPresented: $showRestoreConfirmation,
            presenting: entryToRestore
        ) { entry in
            Button("Restore", role: .destructive) {
                Task {
                    do {
                        try await backupService.restoreFromBackup(entry)
                        restoreError = nil
                    } catch {
                        restoreError = error.localizedDescription
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: { entry in
            Text("This will replace all current data with the backup from \(entry.timestamp.formatted()). Embeddings will need to be re-indexed. This cannot be undone.")
        }
        .alert("Restore Failed", isPresented: .init(
            get: { restoreError != nil },
            set: { if !$0 { restoreError = nil } }
        )) {
            Button("OK") { restoreError = nil }
        } message: {
            Text(restoreError ?? "")
        }
    }

    private var headerView: some View {
        HStack(spacing: 12) {
            Text("Backup Timeline")
                .font(.title2)
                .fontWeight(.bold)

            Spacer()

            if backupService.isBackingUp {
                ProgressView(value: backupService.backupProgress)
                    .frame(width: 120)
                Text("Backing up...")
                    .font(.caption)
                    .foregroundColor(.secondary)
            } else if let lastDate = backupService.lastBackupDate {
                Text("Last backup: \(lastDate, style: .relative) ago")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            if let error = backupService.lastError {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundColor(.red)
                    .lineLimit(1)
            }

            Button {
                Task { await backupService.createBackup() }
            } label: {
                Label("Backup Now", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.regular)
            .disabled(backupService.isBackingUp)
        }
        .padding()
    }
}

// MARK: - Timeline Entry Row

struct TimelineEntryRow: View {
    let entry: BackupEntry
    let isExpanded: Bool
    let onToggle: () -> Void
    let onRestore: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Timeline line + marker
            VStack(spacing: 0) {
                Circle()
                    .fill(Color.accentColor)
                    .frame(width: 12, height: 12)

                Rectangle()
                    .fill(Color.accentColor.opacity(0.3))
                    .frame(width: 2)
            }
            .frame(width: 12)

            // Card content
            VStack(alignment: .leading, spacing: 8) {
                Button(action: onToggle) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(entry.timestamp, style: .relative)
                                .font(.headline)
                                + Text(" ago")
                                .font(.headline)
                                .foregroundColor(.secondary)

                            Text(entry.timestamp.formatted(date: .abbreviated, time: .shortened))
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }

                        Spacer()

                        Text(entry.changeSummary)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .lineLimit(1)

                        sizeBadge

                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .foregroundColor(.secondary)
                            .font(.caption)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if isExpanded {
                    expandedContent
                }
            }
            .padding(12)
            .background(Color(nsColor: .controlBackgroundColor))
            .cornerRadius(8)
        }
        .padding(.bottom, 4)
    }

    private var sizeBadge: some View {
        Text(ByteCountFormatter.string(fromByteCount: entry.sizeBytes, countStyle: .file))
            .font(.caption2)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color.secondary.opacity(0.15))
            .cornerRadius(4)
    }

    @ViewBuilder
    private var expandedContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 16) {
                Label("\(entry.projectCount) projects", systemImage: "folder")
                Label("\(entry.totalItems) items", systemImage: "doc.text")
            }
            .font(.caption)
            .foregroundColor(.secondary)

            // Load and display changes
            ChangeDetailView(entry: entry)

            HStack {
                Spacer()
                Button(role: .destructive) {
                    onRestore()
                } label: {
                    Label("Restore to this point", systemImage: "arrow.uturn.backward")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
        }
    }
}

// MARK: - Change Detail View

struct ChangeDetailView: View {
    let entry: BackupEntry
    @State private var changes: BackupChanges?

    var body: some View {
        Group {
            if let changes = changes {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(changes.sections) { section in
                        if !section.isEmpty {
                            Text(section.category)
                                .font(.caption)
                                .fontWeight(.semibold)

                            changeItems(label: "Added", items: section.added, color: .green)
                            changeItems(label: "Modified", items: section.modified, color: .blue)
                            changeItems(label: "Removed", items: section.removed, color: .red)
                        }
                    }
                }
            }
        }
        .task {
            loadChanges()
        }
    }

    @ViewBuilder
    private func changeItems(label: String, items: [ChangeItem], color: Color) -> some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(items) { item in
                    HStack(spacing: 4) {
                        Circle()
                            .fill(color)
                            .frame(width: 6, height: 6)
                        Text(item.title)
                            .font(.caption2)
                        if let detail = item.detail {
                            Text("(\(detail))")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }
            .padding(.leading, 8)
        }
    }

    private func loadChanges() {
        let settings = AppSettings.shared
        let baseURL: URL
        if let customURL = settings.backupLocationURL {
            _ = customURL.startAccessingSecurityScopedResource()
            baseURL = customURL
        } else {
            let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            baseURL = appSupport.appendingPathComponent("Aetherium/Backups")
        }

        let changesURL = baseURL
            .appendingPathComponent(entry.directoryName)
            .appendingPathComponent("changes.json")

        guard let data = try? Data(contentsOf: changesURL) else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        changes = try? decoder.decode(BackupChanges.self, from: data)
    }
}
