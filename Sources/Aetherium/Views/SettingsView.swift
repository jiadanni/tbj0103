import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var themeManager: ThemeManager
    @EnvironmentObject var shortcutManager: ShortcutManager

    var body: some View {
        TabView {
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
        .frame(width: 500, height: 400)
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

            // Modifier picker (simplified for demo purposes, normally you'd use a more complex key recorder)
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
                .onChange(of: shortcut) { oldValue, newValue in
                    if newValue.count > 1 {
                        shortcut = String(newValue.last ?? " ")
                    }
                    shortcut = shortcut.lowercased()
                }
        }
    }
}
