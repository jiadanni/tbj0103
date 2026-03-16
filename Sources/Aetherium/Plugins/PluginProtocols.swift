import Foundation
import SwiftUI
import SwiftData

// MARK: - Plugin Protocol Definitions

/// Base protocol for all Aetherium plugins
@MainActor
protocol AetheriumPlugin {
    /// Unique identifier for the plugin
    var id: String { get }

    /// Human-readable name
    var name: String { get }

    /// Plugin description
    var description: String { get }

    /// Plugin version
    var version: String { get }

    /// Plugin author
    var author: String { get }

    /// Plugin icon (SF Symbol name)
    var icon: String { get }

    /// Plugin type
    var type: PluginType { get }

    /// Initialization method called when plugin is loaded
    func initialize() async throws

    /// Cleanup method called when plugin is unloaded
    func cleanup() async
}

// MARK: - Plugin Types

enum PluginType: String, Codable {
    case importer = "Importer"
    case exporter = "Exporter"
    case aiModel = "AI Model"
    case visualization = "Visualization"
    case automation = "Automation"
    case noteType = "Note Type"
    case integration = "Integration"
}

// MARK: - Importer Plugin Protocol

@MainActor
protocol ImporterPlugin: AetheriumPlugin {
    /// Supported file types (UTI identifiers)
    var supportedFileTypes: [String] { get }

    /// Import data from file
    func importData(from url: URL, into project: Workspace, context: ModelContext) async throws -> ImportResult
}

struct ImportResult {
    let sources: [ProjectSource]
    let concepts: [ConceptNode]
    let notes: [ProjectNote]
    let message: String
}

// MARK: - Exporter Plugin Protocol

@MainActor
protocol ExporterPlugin: AetheriumPlugin {
    /// Export format name (e.g., "Notion", "Roam Research")
    var exportFormat: String { get }

    /// File extension for exported files
    var fileExtension: String { get }

    /// Export project data
    func exportProject(_ project: Workspace, to url: URL, context: ModelContext) async throws

    /// Can export partial data (selected items)
    var supportsPartialExport: Bool { get }

    /// Export selected items
    func exportItems(_ items: [Any], to url: URL, context: ModelContext) async throws
}

// MARK: - AI Model Plugin Protocol

@MainActor
protocol AIModelPlugin: AetheriumPlugin {
    /// Model identifier (e.g., "gpt-4", "claude-3")
    var modelID: String { get }

    /// Model display name
    var modelDisplayName: String { get }

    /// Is model available locally or requires API?
    var isLocal: Bool { get }

    /// Generate response
    func generateResponse(
        prompt: String,
        context: [String],
        temperature: Double,
        maxTokens: Int?
    ) async throws -> String

    /// Generate embeddings
    func generateEmbedding(_ text: String) async throws -> [Float]

    /// Supports streaming responses
    var supportsStreaming: Bool { get }

    /// Generate streaming response
    func generateStreamingResponse(
        prompt: String,
        context: [String],
        onChunk: @escaping (String) -> Void
    ) async throws
}

// MARK: - Visualization Plugin Protocol

@MainActor
protocol VisualizationPlugin: AetheriumPlugin {
    /// Visualization type name
    var visualizationType: String { get }

    /// Create visualization view for project
    func createView(for project: Workspace, context: ModelContext) -> AnyView

    /// Supports export to image
    var supportsImageExport: Bool { get }

    /// Export visualization as image
    func exportAsImage(for project: Workspace, context: ModelContext) async throws -> Data
}

// MARK: - Automation Plugin Protocol

@MainActor
protocol AutomationPlugin: AetheriumPlugin {
    /// Automation triggers
    var triggers: [AutomationTrigger] { get }

    /// Execute automation
    func execute(
        trigger: AutomationTrigger,
        context: AutomationContext,
        modelContext: ModelContext
    ) async throws

    /// Configuration view (optional)
    func configurationView() -> AnyView?
}

enum AutomationTrigger: String, Codable {
    case dailySchedule = "Daily Schedule"
    case projectCreated = "Project Created"
    case noteCreated = "Note Created"
    case chatCompleted = "Chat Completed"
    case reviewCompleted = "Review Completed"
    case manual = "Manual"
}

struct AutomationContext {
    let project: Workspace?
    let triggerData: [String: Any]
    let timestamp: Date
}

// MARK: - Note Type Plugin Protocol

@MainActor
protocol NoteTypePlugin: AetheriumPlugin {
    /// Custom note type identifier
    var noteTypeID: String { get }

    /// Note type display name
    var noteTypeName: String { get }

    /// Template for new notes of this type
    var template: String { get }

    /// Custom editor view (optional)
    func editorView(for note: ProjectNote, context: ModelContext) -> AnyView?

    /// Custom preview view (optional)
    func previewView(for note: ProjectNote, context: ModelContext) -> AnyView?

    /// Validation rules for note content
    func validate(content: String) -> ValidationResult
}

struct ValidationResult {
    let isValid: Bool
    let errors: [String]
    let warnings: [String]
}

// MARK: - Integration Plugin Protocol

@MainActor
protocol IntegrationPlugin: AetheriumPlugin {
    /// Service name (e.g., "Notion", "Obsidian", "Anki")
    var serviceName: String { get }

    /// Requires authentication
    var requiresAuthentication: Bool { get }

    /// Authentication view
    func authenticationView(onComplete: @escaping (Bool) -> Void) -> AnyView?

    /// Sync data with external service
    func sync(project: Workspace, context: ModelContext) async throws -> SyncResult

    /// Supports two-way sync
    var supportsTwoWaySync: Bool { get }
}

struct SyncResult {
    let itemsSynced: Int
    let itemsCreated: Int
    let itemsUpdated: Int
    let conflicts: Int
    let errors: [String]
}

// MARK: - Plugin Metadata

struct PluginMetadata: Codable {
    let id: String
    let name: String
    let description: String
    let version: String
    let author: String
    let type: PluginType
    let minimumAetheriumVersion: String
    let requiresPermissions: [PluginPermission]
    let homepage: String?
    let repository: String?
}

enum PluginPermission: String, Codable {
    case fileSystem = "File System Access"
    case network = "Network Access"
    case camera = "Camera Access"
    case microphone = "Microphone Access"
    case location = "Location Access"
}

// MARK: - Plugin Error Types

enum PluginError: Error, LocalizedError {
    case initializationFailed(String)
    case incompatibleVersion
    case missingPermissions([PluginPermission])
    case executionFailed(String)
    case notSupported

    var errorDescription: String? {
        switch self {
        case .initializationFailed(let message):
            return "Plugin initialization failed: \(message)"
        case .incompatibleVersion:
            return "Plugin version is incompatible with Aetherium"
        case .missingPermissions(let permissions):
            return "Missing required permissions: \(permissions.map { $0.rawValue }.joined(separator: ", "))"
        case .executionFailed(let message):
            return "Plugin execution failed: \(message)"
        case .notSupported:
            return "Operation not supported by this plugin"
        }
    }
}
