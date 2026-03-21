import AppKit
import Foundation
import SwiftData
import SwiftUI

// MARK: - Plugin Manager

@MainActor
class PluginManager: ObservableObject {
    static let shared = PluginManager()

    @Published var loadedPlugins: [String: AetheriumPlugin] = [:]
    @Published var availablePlugins: [PluginMetadata] = []
    @Published var isLoading = false

    private let pluginsDirectory: URL
    private let fileManager = FileManager.default

    init() {
        // Create plugins directory in Application Support
        let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        pluginsDirectory = appSupport.appendingPathComponent("Aetherium/Plugins")

        try? fileManager.createDirectory(at: pluginsDirectory, withIntermediateDirectories: true)
    }

    // MARK: - Plugin Discovery

    func discoverPlugins() async {
        isLoading = true
        defer { isLoading = false }

        availablePlugins = []

        // Scan plugins directory
        guard let contents = try? fileManager.contentsOfDirectory(
            at: pluginsDirectory,
            includingPropertiesForKeys: nil
        ) else { return }

        for url in contents where url.pathExtension == "aetheriumplugin" {
            if let metadata = loadPluginMetadata(from: url) {
                availablePlugins.append(metadata)
            }
        }

        // Load built-in plugins
        availablePlugins.append(contentsOf: builtInPluginMetadata())
    }

    private func loadPluginMetadata(from url: URL) -> PluginMetadata? {
        let manifestURL = url.appendingPathComponent("manifest.json")

        guard let data = try? Data(contentsOf: manifestURL),
              let metadata = try? JSONDecoder().decode(PluginMetadata.self, from: data) else {
            return nil
        }

        return metadata
    }

    private func builtInPluginMetadata() -> [PluginMetadata] {
        [
            PluginMetadata(
                id: "com.aetherium.markdown-exporter",
                name: "Markdown Exporter",
                description: "Export projects as Markdown files",
                version: "1.0.0",
                author: "Aetherium",
                type: .exporter,
                minimumAetheriumVersion: "1.0.0",
                requiresPermissions: [.fileSystem],
                homepage: nil,
                repository: nil
            ),
            PluginMetadata(
                id: "com.aetherium.obsidian-exporter",
                name: "Obsidian Vault Exporter",
                description: "Export as Obsidian vault",
                version: "1.0.0",
                author: "Aetherium",
                type: .exporter,
                minimumAetheriumVersion: "1.0.0",
                requiresPermissions: [.fileSystem],
                homepage: nil,
                repository: nil
            ),
            PluginMetadata(
                id: "com.aetherium.youtube-importer",
                name: "YouTube Transcript Importer",
                description: "Import YouTube video transcripts",
                version: "1.0.0",
                author: "Aetherium",
                type: .importer,
                minimumAetheriumVersion: "1.0.0",
                requiresPermissions: [.network],
                homepage: nil,
                repository: nil
            ),
            PluginMetadata(
                id: "com.aetherium.anki-exporter",
                name: "Anki Deck Exporter",
                description: "Export flashcards to Anki",
                version: "1.0.0",
                author: "Aetherium",
                type: .exporter,
                minimumAetheriumVersion: "1.0.0",
                requiresPermissions: [.fileSystem],
                homepage: nil,
                repository: nil
            )
        ]
    }

    // MARK: - Plugin Loading

    func loadPlugin(id: String) async throws {
        guard !loadedPlugins.keys.contains(id) else {
            return // Already loaded
        }

        // Find metadata so we can check permissions
        if let metadata = availablePlugins.first(where: { $0.id == id }) {
            guard await requestPermissions(for: metadata) else {
                throw PluginError.missingPermissions(metadata.requiresPermissions)
            }
        }

        // Load built-in plugin
        if let plugin = try await loadBuiltInPlugin(id: id) {
            try await plugin.initialize()
            loadedPlugins[id] = plugin
            return
        }

        // Load external plugin
        // TODO: Implement dynamic plugin loading from bundles
        throw PluginError.notSupported
    }

    func unloadPlugin(id: String) async {
        guard let plugin = loadedPlugins[id] else { return }

        await plugin.cleanup()
        loadedPlugins.removeValue(forKey: id)
    }

    private func loadBuiltInPlugin(id: String) async throws -> AetheriumPlugin? {
        switch id {
        case "com.aetherium.markdown-exporter":
            return MarkdownExporterPlugin()
        case "com.aetherium.obsidian-exporter":
            return ObsidianExporterPlugin()
        case "com.aetherium.youtube-importer":
            return YouTubeImporterPlugin()
        case "com.aetherium.anki-exporter":
            return AnkiExporterPlugin()
        default:
            return nil
        }
    }

    // MARK: - Plugin Execution

    func getPlugins<T: AetheriumPlugin>(ofType type: T.Type) -> [T] {
        loadedPlugins.values.compactMap { $0 as? T }
    }

    func getPlugin(id: String) -> AetheriumPlugin? {
        loadedPlugins[id]
    }

    func executeImporter(
        id: String,
        fileURL: URL,
        project: Workspace,
        context: ModelContext
    ) async throws -> ImportResult {
        guard let plugin = loadedPlugins[id] as? ImporterPlugin else {
            throw PluginError.notSupported
        }

        return try await plugin.importData(from: fileURL, into: project, context: context)
    }

    func executeExporter(
        id: String,
        project: Workspace,
        destinationURL: URL,
        context: ModelContext
    ) async throws {
        guard let plugin = loadedPlugins[id] as? ExporterPlugin else {
            throw PluginError.notSupported
        }

        try await plugin.exportProject(project, to: destinationURL, context: context)
    }

    func executeAutomation(
        id: String,
        trigger: AutomationTrigger,
        automationContext: AutomationContext,
        modelContext: ModelContext
    ) async throws {
        guard let plugin = loadedPlugins[id] as? AutomationPlugin else {
            throw PluginError.notSupported
        }

        try await plugin.execute(trigger: trigger, context: automationContext, modelContext: modelContext)
    }

    // MARK: - Plugin Installation

    func installPlugin(from url: URL) async throws {
        // Validate plugin bundle
        guard url.pathExtension == "aetheriumplugin" else {
            throw PluginError.executionFailed("Invalid plugin bundle")
        }

        // Load and validate manifest
        let manifestURL = url.appendingPathComponent("manifest.json")
        guard let data = try? Data(contentsOf: manifestURL),
              let metadata = try? JSONDecoder().decode(PluginMetadata.self, from: data) else {
            throw PluginError.initializationFailed("Invalid manifest")
        }

        // Check version compatibility
        guard meetsMinimumVersion(metadata.minimumAetheriumVersion) else {
            throw PluginError.incompatibleVersion
        }

        // Copy to plugins directory
        let destination = pluginsDirectory.appendingPathComponent("\(metadata.id).aetheriumplugin")

        if fileManager.fileExists(atPath: destination.path) {
            try fileManager.removeItem(at: destination)
        }

        try fileManager.copyItem(at: url, to: destination)

        // Refresh available plugins
        await discoverPlugins()
    }

    func uninstallPlugin(id: String) async throws {
        // Unload if loaded
        if loadedPlugins.keys.contains(id) {
            await unloadPlugin(id: id)
        }

        // Remove from disk
        let pluginURL = pluginsDirectory.appendingPathComponent("\(id).aetheriumplugin")

        if fileManager.fileExists(atPath: pluginURL.path) {
            try fileManager.removeItem(at: pluginURL)
        }

        // Refresh available plugins
        await discoverPlugins()
    }

    // MARK: - Plugin Permissions

    func requestPermissions(for plugin: PluginMetadata) async -> Bool {
        guard !plugin.requiresPermissions.isEmpty else { return true }
        if hasPermissions(for: plugin) { return true }

        let permissionList = plugin.requiresPermissions
            .map { "  • \($0.rawValue)" }
            .joined(separator: "\n")

        let alert = NSAlert()
        alert.messageText = "\"\(plugin.name)\" Requires Permissions"
        alert.informativeText = "This plugin needs the following permissions:\n\(permissionList)\n\nGrant access to continue."
        alert.addButton(withTitle: "Grant Permissions")
        alert.addButton(withTitle: "Cancel")
        alert.alertStyle = .warning

        guard alert.runModal() == .alertFirstButtonReturn else { return false }

        var current = grantedPermissions
        current[plugin.id] = plugin.requiresPermissions.map { $0.rawValue }
        grantedPermissions = current
        return true
    }

    func hasPermissions(for plugin: PluginMetadata) -> Bool {
        guard !plugin.requiresPermissions.isEmpty else { return true }
        let granted = Set(grantedPermissions[plugin.id] ?? [])
        return plugin.requiresPermissions.allSatisfy { granted.contains($0.rawValue) }
    }

    // MARK: - Private Helpers

    private let currentAppVersion = "1.0.0"
    private let permissionsKey = "Aetherium.GrantedPluginPermissions"

    private var grantedPermissions: [String: [String]] {
        get { UserDefaults.standard.dictionary(forKey: permissionsKey) as? [String: [String]] ?? [:] }
        set { UserDefaults.standard.set(newValue, forKey: permissionsKey) }
    }

    private func meetsMinimumVersion(_ minimumVersion: String) -> Bool {
        let cur = versionComponents(currentAppVersion)
        let min = versionComponents(minimumVersion)
        for i in 0..<3 {
            let c = i < cur.count ? cur[i] : 0
            let m = i < min.count ? min[i] : 0
            if c > m { return true }
            if c < m { return false }
        }
        return true
    }

    private func versionComponents(_ version: String) -> [Int] {
        version.split(separator: ".").compactMap { Int($0) }
    }
}

// MARK: - Plugin Store

@MainActor
class PluginStore: ObservableObject {
    @Published var featuredPlugins: [PluginMetadata] = []
    @Published var categories: [String: [PluginMetadata]] = [:]

    func loadFeaturedPlugins() async {
        if PluginManager.shared.availablePlugins.isEmpty {
            await PluginManager.shared.discoverPlugins()
        }
        featuredPlugins = PluginManager.shared.availablePlugins
        categories = Dictionary(grouping: featuredPlugins, by: { $0.type.rawValue })
    }

    func searchPlugins(query: String) async -> [PluginMetadata] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else { return featuredPlugins }
        return featuredPlugins.filter {
            $0.name.lowercased().contains(trimmed) ||
            $0.description.lowercased().contains(trimmed) ||
            $0.author.lowercased().contains(trimmed)
        }
    }

    func downloadPlugin(id: String) async throws -> URL {
        // TODO: Implement plugin download
        throw PluginError.notSupported
    }
}
