import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var ollamaService: OllamaService
    @EnvironmentObject var securityManager: SecurityManager
    @EnvironmentObject var themeManager: ThemeManager
    @EnvironmentObject var shortcutManager: ShortcutManager
    @EnvironmentObject var backupService: BackupService
    @ObservedObject private var appSettings = AppSettings.shared

    @State private var isLoadingModels = false

    private let autoLockOptions: [(String, Int)] = [
        ("Never", 0),
        ("1 minute", 1),
        ("5 minutes", 5),
        ("15 minutes", 15),
        ("30 minutes", 30),
        ("1 hour", 60)
    ]

    var body: some View {
        TabView {
            generalSettingsTab
                .tabItem {
                    Label("General", systemImage: "gear")
                }

            AppearanceSettingsView()
                .tabItem {
                    Label("Appearance", systemImage: "paintpalette")
                }

            KeyboardShortcutsSettingsView()
                .tabItem {
                    Label("Shortcuts", systemImage: "keyboard")
                }
        }
        .padding()
        .frame(width: 550, height: 500)
        .task {
            loadModels()
        }
    }

    private var generalSettingsTab: some View {
        Form {
            Section("Security") {
                Toggle("Require Touch ID", isOn: $appSettings.touchIDEnabled)
                    .onChange(of: appSettings.touchIDEnabled) { _, enabled in
                        if !enabled {
                            securityManager.isAuthenticated = true
                            securityManager.setupAutoLock(after: 0)
                            appSettings.autoLockMinutes = 0
                        }
                    }

                if securityManager.biometricType == .none {
                    Label("No biometric hardware detected. Password will be used instead.", systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundColor(.orange)
                }

                Picker("Auto-Lock Timeout", selection: $appSettings.autoLockMinutes) {
                    ForEach(autoLockOptions, id: \.1) { option in
                        Text(option.0).tag(option.1)
                    }
                }
                .disabled(!appSettings.touchIDEnabled)
                .onChange(of: appSettings.autoLockMinutes) { _, minutes in
                    securityManager.setupAutoLock(after: minutes)
                }

                Text("Locks the app after a period of inactivity. Requires re-authentication to continue.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Section("Model") {
                if !ollamaService.availableModels.isEmpty {
                    Picker("Default Model", selection: $appSettings.preferredModel) {
                        ForEach(ollamaService.availableModels) { model in
                            Text(model.name).tag(model.name)
                        }
                    }
                } else if isLoadingModels {
                    HStack {
                        ProgressView()
                            .controlSize(.small)
                        Text("Loading models from Ollama...")
                            .foregroundColor(.secondary)
                    }
                } else {
                    HStack {
                        Text("Current: \(appSettings.preferredModel)")
                            .foregroundColor(.secondary)
                        Spacer()
                        Button("Refresh") {
                            loadModels()
                        }
                    }
                }

                if !ollamaService.isAvailable && !isLoadingModels {
                    Label("Ollama is not running. Start it to see installed models.", systemImage: "exclamationmark.triangle")
                        .foregroundColor(.orange)
                        .font(.caption)
                }
            }

            BackupSettingsSection()

            Section("Layout") {
                Picker("Project Navigation", selection: $appSettings.projectTabPosition) {
                    ForEach(ProjectTabPosition.allCases, id: \.rawValue) { position in
                        Text(position.rawValue).tag(position.rawValue)
                    }
                }
                .pickerStyle(.radioGroup)

                Text("Horizontal Tabs shows projects as tabs across the top. Sidebar uses the classic left panel.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Section("Embedding") {
                if !ollamaService.availableModels.isEmpty {
                    Picker("Embedding Model", selection: $appSettings.preferredEmbeddingModel) {
                        ForEach(ollamaService.availableModels) { model in
                            Text(model.name).tag(model.name)
                        }
                    }
                } else {
                    HStack {
                        Text("Current: \(appSettings.preferredEmbeddingModel)")
                            .foregroundColor(.secondary)
                    }
                }

                Text("Used for semantic search and document indexing")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .formStyle(.grouped)
        .frame(width: 450, height: 700)
        .task {
            loadModels()
        }
    }

    private func loadModels() {
        isLoadingModels = true
        Task {
            _ = await ollamaService.checkAvailability()
            if ollamaService.isAvailable {
                _ = try? await ollamaService.fetchAvailableModels()
            }
            isLoadingModels = false
        }
    }
}

struct AppearanceSettingsView: View {
    @EnvironmentObject var themeManager: ThemeManager

    var body: some View {
        Form {
            Section("Theme") {
                Picker("Appearance", selection: $themeManager.selectedTheme) {
                    ForEach(ThemeManager.Theme.allCases) { theme in
                        Text(theme.rawValue).tag(theme)
                    }
                }
                .pickerStyle(.segmented)
            }

            Section("Colors") {
                Picker("Accent Color", selection: $themeManager.accentColor) {
                    ForEach(ThemeManager.AppAccentColor.allCases) { color in
                        Text(color.rawValue).tag(color)
                    }
                }

                if themeManager.accentColor == .custom {
                    ColorPicker(
                        "Custom Accent",
                        selection: Binding(
                            get: { themeManager.customAccentColor },
                            set: { themeManager.customAccentColor = $0 }
                        )
                    )
                }
            }

            Section("Typography") {
                VStack(alignment: .leading) {
                    Text("Editor Font Size (\(String(format: "%.1fx", themeManager.fontSizeMultiplier)))")
                    Slider(value: $themeManager.fontSizeMultiplier, in: 0.5...2.0, step: 0.1)
                }
            }

            Section("Layout") {
                Toggle("Collapse Sidebar by Default", isOn: $themeManager.isSidebarCollapsed)

                VStack(alignment: .leading) {
                    Text("Sidebar Width (\(Int(themeManager.sidebarWidth))pt)")
                    Slider(value: $themeManager.sidebarWidth, in: 200...400, step: 10)
                }
            }
        }
        .padding()
    }
}

struct KeyboardShortcutsSettingsView: View {
    @EnvironmentObject var shortcutManager: ShortcutManager

    var body: some View {
        Form {
            Section("Navigation") {
                ShortcutEditorRow(
                    action: "Command Palette",
                    shortcut: $shortcutManager.searchShortcut,
                    modifiers: $shortcutManager.searchModifiersRaw
                )
                ShortcutEditorRow(
                    action: "Toggle Sidebar",
                    shortcut: $shortcutManager.toggleSidebarShortcut,
                    modifiers: $shortcutManager.toggleSidebarModifiersRaw
                )
            }
            Section("Actions") {
                ShortcutEditorRow(
                    action: "New Project",
                    shortcut: $shortcutManager.newProjectShortcut,
                    modifiers: $shortcutManager.newProjectModifiersRaw
                )
                ShortcutEditorRow(
                    action: "New Chat",
                    shortcut: $shortcutManager.newChatShortcut,
                    modifiers: $shortcutManager.newChatModifiersRaw
                )
            }
        }
        .padding()
    }
}

struct ShortcutEditorRow: View {
    let action: String
    @Binding var shortcut: String
    @Binding var modifiers: Int

    var body: some View {
        HStack {
            Text(action)
            Spacer()

            Picker("", selection: $modifiers) {
                Text("⌘").tag(EventModifiers.command.rawValue)
                Text("⇧⌘").tag(EventModifiers.command.rawValue | EventModifiers.shift.rawValue)
                Text("⌥⌘").tag(EventModifiers.command.rawValue | EventModifiers.option.rawValue)
                Text("⌃⌘").tag(EventModifiers.command.rawValue | EventModifiers.control.rawValue)
            }
            .frame(width: 80)

            TextField("", text: $shortcut)
                .frame(width: 40)
                .multilineTextAlignment(.center)
                .onChange(of: shortcut) { _, newValue in
                    if newValue.count > 1 {
                        shortcut = String(newValue.last ?? " ")
                    }
                    shortcut = shortcut.lowercased()
                }
        }
    }
}
