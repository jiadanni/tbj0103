import SwiftUI

struct BackupSettingsSection: View {
    @ObservedObject private var appSettings = AppSettings.shared
    @EnvironmentObject var backupService: BackupService

    @State private var showingFolderPicker = false

    private let intervalOptions: [(String, Int)] = [
        ("15 minutes", 15),
        ("30 minutes", 30),
        ("1 hour", 60),
        ("4 hours", 240),
        ("Daily", 1440)
    ]

    private let retentionOptions: [(String, Int)] = [
        ("Last 10", 10),
        ("Last 25", 25),
        ("Last 50", 50),
        ("Last 100", 100)
    ]

    var body: some View {
        Section("Backups") {
            Toggle("Enable Automatic Backups", isOn: $appSettings.backupEnabled)
                .onChange(of: appSettings.backupEnabled) { _, enabled in
                    if enabled {
                        backupService.startScheduledBackups(intervalMinutes: appSettings.backupIntervalMinutes)
                    } else {
                        backupService.stopScheduledBackups()
                    }
                }

            Picker("Backup Interval", selection: $appSettings.backupIntervalMinutes) {
                ForEach(intervalOptions, id: \.1) { option in
                    Text(option.0).tag(option.1)
                }
            }
            .disabled(!appSettings.backupEnabled)
            .onChange(of: appSettings.backupIntervalMinutes) { _, minutes in
                if appSettings.backupEnabled {
                    backupService.startScheduledBackups(intervalMinutes: minutes)
                }
            }

            HStack {
                Text("Location")
                Spacer()
                Text(appSettings.backupLocationDisplay)
                    .foregroundColor(.secondary)
                Button("Choose...") {
                    showingFolderPicker = true
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
            .fileImporter(
                isPresented: $showingFolderPicker,
                allowedContentTypes: [.folder],
                allowsMultipleSelection: false
            ) { result in
                if case .success(let urls) = result, let url = urls.first {
                    if let bookmark = try? url.bookmarkData(
                        options: .withSecurityScope,
                        includingResourceValuesForKeys: nil,
                        relativeTo: nil
                    ) {
                        appSettings.backupLocationBookmark = bookmark
                    }
                }
            }

            if appSettings.backupLocationURL != nil {
                Button("Reset to Default Location") {
                    appSettings.backupLocationBookmark = Data()
                }
                .font(.caption)
            }

            Picker("Retention", selection: $appSettings.backupRetentionCount) {
                ForEach(retentionOptions, id: \.1) { option in
                    Text(option.0).tag(option.1)
                }
            }

            Text("Periodic snapshots of your data are saved locally. " +
                 "You can browse and restore from any point in the Backup Timeline. " +
                 "Embeddings are excluded from backups and will be re-indexed after a restore.")
                .font(.caption)
                .foregroundColor(.secondary)
        }
    }
}
