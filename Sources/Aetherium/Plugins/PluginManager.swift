import Foundation
import SwiftUI
import SwiftData

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
        let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
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
        project: AetheriumProject,
        context: ModelContext
    ) async throws -> ImportResult {
        guard let plugin = loadedPlugins[id] as? ImporterPlugin else {
            throw PluginError.notSupported
        }

        return try await plugin.importData(from: fileURL, into: project, context: context)
    }

    func executeExporter(
        id: String,
        project: AetheriumProject,
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
        // TODO: Implement version checking

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
        // TODO: Implement permission request UI
        // For now, auto-grant all permissions
        return true
    }

    func hasPermissions(for plugin: PluginMetadata) -> Bool {
        // TODO: Check granted permissions
        return true
    }
}

// MARK: - Plugin Store

@MainActor
class PluginStore: ObservableObject {
    @Published var featuredPlugins: [PluginMetadata] = []
    @Published var categories: [String: [PluginMetadata]] = [:]

    func loadFeaturedPlugins() async {
        // TODO: Fetch from plugin registry/API
        featuredPlugins = []
    }

    func searchPlugins(query: String) async -> [PluginMetadata] {
        // TODO: Implement plugin search
        return []
    }

    func downloadPlugin(id: String) async throws -> URL {
        // TODO: Implement plugin download
        throw PluginError.notSupported
    }
}
