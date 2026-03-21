import SwiftData
import SwiftUI

// MARK: - Plugin Manager View

struct PluginManagerView: View {
    @StateObject private var pluginManager = PluginManager.shared
    @StateObject private var pluginStore = PluginStore()
    @State private var selectedTab: PluginTab = .installed
    @State private var selectedPlugin: PluginMetadata?
    @State private var showingInstallSheet = false
    @State private var storeSearchText = ""

    enum PluginTab: String, CaseIterable {
        case installed = "Installed"
        case available = "Available"
        case store = "Plugin Store"
    }

    var body: some View {
        HSplitView {
            // Sidebar with tabs
            VStack(spacing: 0) {
                Picker("View", selection: $selectedTab) {
                    ForEach(PluginTab.allCases, id: \.self) { tab in
                        Text(tab.rawValue).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .padding()

                Divider()

                if selectedTab == .store {
                    TextField("Search plugins…", text: $storeSearchText)
                        .textFieldStyle(.roundedBorder)
                        .padding(.horizontal)
                        .padding(.top, 8)
                }

                // Plugin list
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(filteredPlugins, id: \.id) { plugin in
                            PluginRowView(
                                plugin: plugin,
                                isInstalled: isPluginInstalled(plugin.id),
                                isLoaded: pluginManager.loadedPlugins.keys.contains(plugin.id),
                                onSelect: { selectedPlugin = plugin }
                            )
                        }
                    }
                    .padding()
                }
            }
            .frame(minWidth: 250, maxWidth: 350)

            // Detail view
            if let plugin = selectedPlugin {
                PluginDetailView(
                    plugin: plugin,
                    isInstalled: isPluginInstalled(plugin.id),
                    isLoaded: pluginManager.loadedPlugins.keys.contains(plugin.id),
                    onLoad: { await loadPlugin(plugin.id) },
                    onUnload: { await unloadPlugin(plugin.id) },
                    onInstall: { showingInstallSheet = true },
                    onUninstall: { await uninstallPlugin(plugin.id) }
                )
            } else {
                ContentUnavailableView(
                    "No Plugin Selected",
                    systemImage: "puzzlepiece.extension",
                    description: Text("Select a plugin to view details")
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationTitle("Plugins")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Button(action: refreshPlugins) {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
            }

            ToolbarItem(placement: .automatic) {
                Button(action: { showingInstallSheet = true }) {
                    Label("Install Plugin", systemImage: "plus.circle")
                }
            }
        }
        .task {
            await pluginManager.discoverPlugins()
            await pluginStore.loadFeaturedPlugins()
        }
        .fileImporter(
            isPresented: $showingInstallSheet,
            allowedContentTypes: [.package],
            onCompletion: handlePluginInstall
        )
    }

    // MARK: - Computed Properties

    private var filteredPlugins: [PluginMetadata] {
        switch selectedTab {
        case .installed:
            return pluginManager.availablePlugins.filter { isPluginInstalled($0.id) }
        case .available:
            return pluginManager.availablePlugins
        case .store:
            let query = storeSearchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if query.isEmpty {
                return pluginStore.featuredPlugins
            }
            return pluginStore.featuredPlugins.filter {
                $0.name.lowercased().contains(query) ||
                $0.description.lowercased().contains(query)
            }
        }
    }

    private func isPluginInstalled(_ id: String) -> Bool {
        // Built-in plugins are always "installed"
        id.hasPrefix("com.aetherium.") || pluginManager.loadedPlugins.keys.contains(id)
    }

    // MARK: - Actions

    private func refreshPlugins() {
        Task {
            await pluginManager.discoverPlugins()
        }
    }

    private func loadPlugin(_ id: String) async {
        do {
            try await pluginManager.loadPlugin(id: id)
        } catch {
            print("Failed to load plugin: \(error)")
        }
    }

    private func unloadPlugin(_ id: String) async {
        await pluginManager.unloadPlugin(id: id)
    }

    private func uninstallPlugin(_ id: String) async {
        do {
            try await pluginManager.uninstallPlugin(id: id)
            selectedPlugin = nil
        } catch {
            print("Failed to uninstall plugin: \(error)")
        }
    }

    private func handlePluginInstall(_ result: Result<URL, Error>) {
        guard case .success(let url) = result else { return }

        Task {
            do {
                try await pluginManager.installPlugin(from: url)
                await pluginManager.discoverPlugins()
            } catch {
                print("Failed to install plugin: \(error)")
            }
        }
    }
}

// MARK: - Plugin Row View

struct PluginRowView: View {
    let plugin: PluginMetadata
    let isInstalled: Bool
    let isLoaded: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 12) {
                // Icon
                Image(systemName: typeIcon(plugin.type))
                    .font(.title2)
                    .foregroundColor(typeColor(plugin.type))
                    .frame(width: 40, height: 40)
                    .background(typeColor(plugin.type).opacity(0.1))
                    .cornerRadius(8)

                // Info
                VStack(alignment: .leading, spacing: 4) {
                    Text(plugin.name)
                        .font(.headline)
                        .lineLimit(1)

                    HStack(spacing: 8) {
                        Text(plugin.type.rawValue)
                            .font(.caption)
                            .foregroundColor(.secondary)

                        if isLoaded {
                            HStack(spacing: 2) {
                                Circle()
                                    .fill(Color.green)
                                    .frame(width: 6, height: 6)
                                Text("Active")
                                    .font(.caption2)
                                    .foregroundColor(.green)
                            }
                        }
                    }
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 2) {
                    Text("v\(plugin.version)")
                        .font(.caption2)
                        .foregroundColor(.secondary)

                    Text(plugin.author)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            .padding()
            .background(Color.secondary.opacity(0.05))
            .cornerRadius(8)
        }
        .buttonStyle(.plain)
    }

    private func typeIcon(_ type: PluginType) -> String {
        switch type {
        case .importer: return "arrow.down.doc"
        case .exporter: return "arrow.up.doc"
        case .aiModel: return "brain"
        case .visualization: return "chart.bar"
        case .automation: return "gearshape.2"
        case .noteType: return "doc.text"
        case .integration: return "link"
        }
    }

    private func typeColor(_ type: PluginType) -> Color {
        switch type {
        case .importer: return .blue
        case .exporter: return .green
        case .aiModel: return .purple
        case .visualization: return .orange
        case .automation: return .pink
        case .noteType: return .indigo
        case .integration: return .cyan
        }
    }
}

// MARK: - Plugin Detail View

struct PluginDetailView: View {
    let plugin: PluginMetadata
    let isInstalled: Bool
    let isLoaded: Bool
    let onLoad: () async -> Void
    let onUnload: () async -> Void
    let onInstall: () -> Void
    let onUninstall: () async -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                // Header
                HStack(alignment: .top, spacing: 16) {
                    Image(systemName: plugin.type == .importer ? "arrow.down.doc" : "puzzlepiece.extension")
                        .font(.system(size: 60))
                        .foregroundColor(.blue)

                    VStack(alignment: .leading, spacing: 8) {
                        Text(plugin.name)
                            .font(.title)
                            .fontWeight(.bold)

                        Text("by \(plugin.author)")
                            .foregroundColor(.secondary)

                        HStack(spacing: 12) {
                            Label(plugin.type.rawValue, systemImage: "tag")
                            Label("v\(plugin.version)", systemImage: "number")
                        }
                        .font(.caption)
                        .foregroundColor(.secondary)
                    }
                }

                Divider()

                // Description
                VStack(alignment: .leading, spacing: 8) {
                    Text("Description")
                        .font(.headline)

                    Text(plugin.description)
                        .foregroundColor(.secondary)
                }

                // Permissions
                if !plugin.requiresPermissions.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Required Permissions")
                            .font(.headline)

                        ForEach(plugin.requiresPermissions, id: \.self) { permission in
                            HStack {
                                Image(systemName: permissionIcon(permission))
                                    .foregroundColor(.orange)
                                Text(permission.rawValue)
                                    .font(.body)
                            }
                        }
                    }
                }

                // Links
                if plugin.homepage != nil || plugin.repository != nil {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Links")
                            .font(.headline)

                        if let homepage = plugin.homepage, let url = URL(string: homepage) {
                            Link(destination: url) {
                                Label("Homepage", systemImage: "house")
                            }
                        }

                        if let repo = plugin.repository, let url = URL(string: repo) {
                            Link(destination: url) {
                                Label("Source Code", systemImage: "chevron.left.forwardslash.chevron.right")
                            }
                        }
                    }
                }

                Divider()

                // Actions
                VStack(spacing: 12) {
                    if isInstalled {
                        if isLoaded {
                            Button(action: { Task { await onUnload() } }) {
                                Label("Unload Plugin", systemImage: "stop.circle")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                        } else {
                            Button(action: { Task { await onLoad() } }) {
                                Label("Load Plugin", systemImage: "play.circle")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                        }

                        if !plugin.id.hasPrefix("com.aetherium.") {
                            Button(role: .destructive, action: { Task { await onUninstall() } }) {
                                Label("Uninstall", systemImage: "trash")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                        }
                    } else {
                        Button(action: onInstall) {
                            Label("Install Plugin", systemImage: "arrow.down.circle")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }
            }
            .padding()
        }
    }

    private func permissionIcon(_ permission: PluginPermission) -> String {
        switch permission {
        case .fileSystem: return "folder"
        case .network: return "network"
        case .camera: return "camera"
        case .microphone: return "mic"
        case .location: return "location"
        }
    }
}
