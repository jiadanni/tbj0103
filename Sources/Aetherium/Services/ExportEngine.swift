import Foundation
import SwiftData
import AppKit

// MARK: - Export Engine

@MainActor
class ExportEngine: ObservableObject {
    @Published var isExporting = false
    @Published var exportProgress: Double = 0.0

    private let modelContext: ModelContext

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
    }

    // MARK: - Export Project

    /// Export entire project to various formats
    func exportProject(
        _ project: AetheriumProject,
        format: ExportFormat,
        to url: URL
    ) async throws {
        isExporting = true
        exportProgress = 0.0

        defer {
            isExporting = false
            exportProgress = 0.0
        }

        switch format {
        case .markdown:
            try await exportAsMarkdown(project, to: url)
        case .obsidian:
            try await exportAsObsidianVault(project, to: url)
        case .pdf:
            try await exportAsPDF(project, to: url)
        case .json:
            try await exportAsJSON(project, to: url)
        }
    }

    // MARK: - Markdown Export

    private func exportAsMarkdown(_ project: AetheriumProject, to url: URL) async throws {
        var content = """
        # \(project.title)

        \(project.projectDescription)

        ---

        ## 📚 Sources

        """

        exportProgress = 0.1

        // Export sources
        for source in project.sources {
            content += "\n### \(source.title)\n\n"

            if let doc = source.document {
                content += doc.extractedText + "\n\n"
            } else if let note = source.note {
                content += note.content + "\n\n"
            }
        }

        exportProgress = 0.4

        // Export concepts
        content += "\n## 🧠 Concepts\n\n"
        for concept in project.concepts {
            content += "### [[\(concept.name)]]\n\n"
            if let desc = concept.conceptDescription {
                content += "\(desc)\n\n"
            }

            if !concept.linkedConcepts.isEmpty {
                content += "**Related:** "
                content += concept.linkedConcepts.map { "[[\($0.name)]" }.joined(separator: ", ")
                content += "\n\n"
            }
        }

        exportProgress = 0.7

        // Export chat sessions
        content += "\n## 💬 Chat Sessions\n\n"
        for chat in project.chatSessions {
            content += "### \(chat.title)\n\n"
            for message in chat.messages.sorted(by: { $0.timestamp < $1.timestamp }) {
                content += "**\(message.role == .user ? "You" : "AI"):** \(message.content)\n\n"
            }
        }

        exportProgress = 0.9

        // Write to file
        try content.write(to: url, atomically: true, encoding: .utf8)

        exportProgress = 1.0
    }

    // MARK: - Obsidian Vault Export

    private func exportAsObsidianVault(_ project: AetheriumProject, to url: URL) async throws {
        // Create vault structure
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: url, withIntermediateDirectories: true)

        exportProgress = 0.1

        // Create folders
        let conceptsFolder = url.appendingPathComponent("Concepts")
        let notesFolder = url.appendingPathComponent("Notes")
        let chatsFolder = url.appendingPathComponent("Chats")

        try fileManager.createDirectory(at: conceptsFolder, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: notesFolder, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: chatsFolder, withIntermediateDirectories: true)

        exportProgress = 0.2

        // Export concepts
        for (index, concept) in project.concepts.enumerated() {
            var content = "# \(concept.name)\n\n"

            if let desc = concept.conceptDescription {
                content += "\(desc)\n\n"
            }

            content += "**Type:** \(concept.type.rawValue)\n\n"

            if !concept.linkedConcepts.isEmpty {
                content += "## Related Concepts\n\n"
                for linked in concept.linkedConcepts {
                    content += "- [[\(linked.name)]]\n"
                }
                content += "\n"
            }

            if !concept.mentions.isEmpty {
                content += "## Mentions\n\n"
                content += "\(concept.mentions.count) references across notes and chats\n\n"
            }

            let filename = sanitizeFilename(concept.name) + ".md"
            try content.write(
                to: conceptsFolder.appendingPathComponent(filename),
                atomically: true,
                encoding: .utf8
            )

            if !project.concepts.isEmpty {
                exportProgress = 0.2 + (Double(index) / Double(project.concepts.count)) * 0.3
            }
        }

        exportProgress = 0.5

        // Export notes
        for (index, source) in project.sources.enumerated() where source.type == .note {
            if let note = source.note {
                let filename = sanitizeFilename(note.title) + ".md"
                try note.content.write(
                    to: notesFolder.appendingPathComponent(filename),
                    atomically: true,
                    encoding: .utf8
                )
            }

            if !project.sources.isEmpty {
                exportProgress = 0.5 + (Double(index) / Double(project.sources.count)) * 0.3
            }
        }

        exportProgress = 0.8

        // Create index file
        let indexContent = """
        # \(project.title)

        \(project.projectDescription)

        ## Quick Links

        - [[Concepts/README|Concepts]]
        - [[Notes/README|Notes]]
        - [[Chats/README|Chats]]

        ## Statistics

        - **Concepts:** \(project.concepts.count)
        - **Notes:** \(project.sources.filter { $0.type == .note }.count)
        - **Chats:** \(project.chatSessions.count)
        - **Created:** \(project.createdAt.formatted(date: .long, time: .omitted))

        """

        try indexContent.write(
            to: url.appendingPathComponent("README.md"),
            atomically: true,
            encoding: .utf8
        )

        exportProgress = 1.0
    }

    // MARK: - PDF Export

    private func exportAsPDF(_ project: AetheriumProject, to url: URL) async throws {
        // Generate HTML content first
        let htmlContent = generateHTMLContent(for: project)

        // Convert HTML to PDF using NSAttributedString
        guard let data = htmlContent.data(using: .utf8) else {
            throw ExportError.conversionFailed
        }

        let options: [NSAttributedString.DocumentReadingOptionKey: Any] = [
            .documentType: NSAttributedString.DocumentType.html,
            .characterEncoding: String.Encoding.utf8.rawValue
        ]

        guard let attributedString = try? NSAttributedString(data: data, options: options, documentAttributes: nil) else {
            throw ExportError.conversionFailed
        }

        // Create PDF data
        guard let printInfoDict = NSPrintInfo.shared.dictionary().mutableCopy() as? NSMutableDictionary else {
            throw ExportError.conversionFailed
        }
        printInfoDict[NSPrintInfo.AttributeKey.jobDisposition] = NSPrintInfo.JobDisposition.save
        printInfoDict[NSPrintInfo.AttributeKey.jobSavingURL] = url

        guard let printInfoDictTyped = printInfoDict as? [NSPrintInfo.AttributeKey: Any] else {
            throw ExportError.conversionFailed
        }
        let printInfo = NSPrintInfo(dictionary: printInfoDictTyped)
        printInfo.paperSize = NSSize(width: 612, height: 792) // Letter size
        printInfo.topMargin = 72
        printInfo.bottomMargin = 72
        printInfo.leftMargin = 72
        printInfo.rightMargin = 72

        let view = NSTextView(frame: NSRect(x: 0, y: 0, width: 468, height: 648))
        view.textStorage?.setAttributedString(attributedString)

        let printOperation = NSPrintOperation(view: view, printInfo: printInfo)
        printOperation.showsPrintPanel = false
        printOperation.showsProgressPanel = false
        printOperation.run()
        
        exportProgress = 1.0
    }

    // MARK: - JSON Export

    private func exportAsJSON(_ project: AetheriumProject, to url: URL) async throws {
        let exportData = ProjectExportData(project: project)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601

        let data = try encoder.encode(exportData)
        try data.write(to: url)

        exportProgress = 1.0
    }

    // MARK: - Helpers

    private func generateHTMLContent(for project: AetheriumProject) -> String {
        var html = """
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 40px; }
                h1 { color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 10px; }
                h2 { color: #0066cc; margin-top: 30px; }
                .concept { background: #f5f5f5; padding: 15px; margin: 10px 0; border-radius: 5px; }
                .link { color: #0066cc; text-decoration: none; }
            </style>
        </head>
        <body>
            <h1>\(project.title)</h1>
            <p>\(project.projectDescription)</p>

            <h2>Concepts</h2>
        """

        for concept in project.concepts {
            html += """
                <div class="concept">
                    <h3>\(concept.name)</h3>
                    <p>\(concept.conceptDescription ?? "")</p>
                </div>
            """
        }

        html += """
        </body>
        </html>
        """

        return html
    }

    private func sanitizeFilename(_ filename: String) -> String {
        let invalidCharacters = CharacterSet(charactersIn: ":/\\?%*|\"<>")
        return filename.components(separatedBy: invalidCharacters).joined(separator: "-")
    }
}

// MARK: - Export Format

enum ExportFormat: String, CaseIterable {
    case markdown = "Markdown"
    case obsidian = "Obsidian Vault"
    case pdf = "PDF"
    case json = "JSON"

    var fileExtension: String {
        switch self {
        case .markdown: return "md"
        case .obsidian: return "" // Directory
        case .pdf: return "pdf"
        case .json: return "json"
        }
    }

    var icon: String {
        switch self {
        case .markdown: return "doc.text"
        case .obsidian: return "folder"
        case .pdf: return "doc.fill"
        case .json: return "chevron.left.forwardslash.chevron.right"
        }
    }
}

// MARK: - Export Data Structure

struct ProjectExportData: Codable {
    let title: String
    let description: String
    let createdAt: Date
    let concepts: [ConceptExport]
    let notes: [NoteExport]
    let sources: Int

    init(project: AetheriumProject) {
        self.title = project.title
        self.description = project.projectDescription
        self.createdAt = project.createdAt
        self.concepts = project.concepts.map { ConceptExport(concept: $0) }
        self.notes = project.sources.compactMap { source in
            guard let note = source.note else { return nil }
            return NoteExport(note: note)
        }
        self.sources = project.sources.count
    }
}

struct ConceptExport: Codable {
    let name: String
    let description: String?
    let type: String
    let references: Int

    init(concept: ConceptNode) {
        self.name = concept.name
        self.description = concept.conceptDescription
        self.type = concept.type.rawValue
        self.references = concept.referenceCount
    }
}

struct NoteExport: Codable {
    let title: String
    let content: String
    let createdAt: Date

    init(note: ProjectNote) {
        self.title = note.title
        self.content = note.content
        self.createdAt = note.createdAt
    }
}

// MARK: - Errors

enum ExportError: Error {
    case conversionFailed
    case fileCreationFailed
    case invalidData
}
