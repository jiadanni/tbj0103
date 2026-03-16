import Foundation
import SwiftUI
import SwiftData

// MARK: - Markdown Exporter Plugin

@MainActor
class MarkdownExporterPlugin: ExporterPlugin {
    let id = "com.aetherium.markdown-exporter"
    let name = "Markdown Exporter"
    let description = "Export projects as Markdown files"
    let version = "1.0.0"
    let author = "Aetherium"
    let icon = "doc.text"
    let type: PluginType = .exporter

    let exportFormat = "Markdown"
    let fileExtension = "md"
    let supportsPartialExport = true

    func initialize() async throws {
        // No initialization needed
    }

    func cleanup() async {
        // No cleanup needed
    }

    func exportProject(_ project: AetheriumProject, to url: URL, context: ModelContext) async throws {
        var content = """
        # \(project.title)

        \(project.projectDescription)

        ---

        """

        // Export concepts
        content += "\n## 🧠 Concepts\n\n"
        for concept in project.concepts {
            content += "### \(concept.name)\n\n"
            if let desc = concept.conceptDescription {
                content += "\(desc)\n\n"
            }
        }

        // Export notes
        content += "\n## 📝 Notes\n\n"
        for source in project.sources where source.type == .note {
            if let note = source.note {
                content += "### \(note.title)\n\n"
                content += "\(note.content)\n\n"
            }
        }

        try content.write(to: url, atomically: true, encoding: .utf8)
    }

    func exportItems(_ items: [Any], to url: URL, context: ModelContext) async throws {
        var content = ""

        for item in items {
            if let concept = item as? ConceptNode {
                content += "# \(concept.name)\n\n"
                if let desc = concept.conceptDescription {
                    content += "\(desc)\n\n"
                }
            } else if let note = item as? ProjectNote {
                content += "# \(note.title)\n\n"
                content += "\(note.content)\n\n"
            }
        }

        try content.write(to: url, atomically: true, encoding: .utf8)
    }
}

// MARK: - Obsidian Exporter Plugin

@MainActor
class ObsidianExporterPlugin: ExporterPlugin {
    let id = "com.aetherium.obsidian-exporter"
    let name = "Obsidian Vault Exporter"
    let description = "Export as Obsidian vault with bidirectional links"
    let version = "1.0.0"
    let author = "Aetherium"
    let icon = "folder"
    let type: PluginType = .exporter

    let exportFormat = "Obsidian Vault"
    let fileExtension = ""
    let supportsPartialExport = false

    func initialize() async throws {}
    func cleanup() async {}

    func exportProject(_ project: AetheriumProject, to url: URL, context: ModelContext) async throws {
        let fileManager = FileManager.default

        // Create vault structure
        try fileManager.createDirectory(at: url, withIntermediateDirectories: true)

        let conceptsFolder = url.appendingPathComponent("Concepts")
        let notesFolder = url.appendingPathComponent("Notes")

        try fileManager.createDirectory(at: conceptsFolder, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: notesFolder, withIntermediateDirectories: true)

        // Export concepts
        for concept in project.concepts {
            var content = "# \(concept.name)\n\n"
            if let desc = concept.conceptDescription {
                content += "\(desc)\n\n"
            }

            // Add linked concepts
            if !concept.linkedConcepts.isEmpty {
                content += "## Related\n\n"
                for linked in concept.linkedConcepts {
                    content += "- [[\(linked.name)]]\n"
                }
            }

            let filename = sanitize(concept.name) + ".md"
            try content.write(
                to: conceptsFolder.appendingPathComponent(filename),
                atomically: true,
                encoding: .utf8
            )
        }

        // Export notes
        for source in project.sources where source.type == .note {
            if let note = source.note {
                let filename = sanitize(note.title) + ".md"
                try note.content.write(
                    to: notesFolder.appendingPathComponent(filename),
                    atomically: true,
                    encoding: .utf8
                )
            }
        }

        // Create index
        let index = """
        # \(project.title)

        \(project.projectDescription)

        ## Quick Links

        - [[Concepts]]
        - [[Notes]]

        ## Statistics

        - Concepts: \(project.concepts.count)
        - Notes: \(project.sources.filter { $0.type == .note }.count)
        """

        try index.write(to: url.appendingPathComponent("README.md"), atomically: true, encoding: .utf8)
    }

    func exportItems(_ items: [Any], to url: URL, context: ModelContext) async throws {
        throw PluginError.notSupported
    }

    private func sanitize(_ filename: String) -> String {
        let invalid = CharacterSet(charactersIn: ":/\\?%*|\"<>")
        return filename.components(separatedBy: invalid).joined(separator: "-")
    }
}

// MARK: - YouTube Importer Plugin

@MainActor
class YouTubeImporterPlugin: ImporterPlugin {
    let id = "com.aetherium.youtube-importer"
    let name = "YouTube Transcript Importer"
    let description = "Import transcripts from YouTube videos"
    let version = "1.0.0"
    let author = "Aetherium"
    let icon = "play.rectangle"
    let type: PluginType = .importer

    let supportedFileTypes = ["public.url"]

    func initialize() async throws {}
    func cleanup() async {}

    func importData(from url: URL, into project: AetheriumProject, context: ModelContext) async throws -> ImportResult {
        // Extract video ID from URL
        guard let videoID = extractVideoID(from: url) else {
            throw PluginError.executionFailed("Invalid YouTube URL")
        }

        // Fetch transcript (simplified - would use YouTube API)
        let transcript = try await fetchTranscript(videoID: videoID)

        // Create note from transcript
        let note = ProjectNote(
            title: "YouTube: \(videoID)",
            content: "# Transcript\n\n" + transcript,
            noteType: .extracted,
            tags: ["youtube", "video", "transcript"]
        )

        let source = ProjectSource(
            sourceType: .note,
            title: "YouTube Video: \(videoID)"
        )
        source.note = note
        source.project = project

        context.insert(source)

        return ImportResult(
            sources: [source],
            concepts: [],
            notes: [note],
            message: "Successfully imported YouTube transcript"
        )
    }

    private func extractVideoID(from url: URL) -> String? {
        // Extract v= parameter from YouTube URL
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        return components?.queryItems?.first(where: { $0.name == "v" })?.value
    }

    private func fetchTranscript(videoID: String) async throws -> String {
        // Use YouTube's timedtext API (works for public videos with captions)
        guard let url = URL(string: "https://www.youtube.com/api/timedtext?v=\(videoID)&lang=en&fmt=json3") else {
            throw PluginError.executionFailed("Invalid video ID")
        }

        let (data, response) = try await URLSession.shared.data(from: url)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw PluginError.executionFailed("Failed to reach YouTube — check your network connection")
        }

        let caption = try JSONDecoder().decode(CaptionResponse.self, from: data)

        guard let events = caption.events, !events.isEmpty else {
            throw PluginError.executionFailed("No English captions available for this video")
        }

        let lines = events.compactMap { event -> String? in
            guard let segs = event.segs else { return nil }
            let text = segs.compactMap(\.utf8).joined()
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }

        return lines.joined(separator: "\n")
    }
}

private struct CaptionResponse: Decodable {
    let events: [CaptionEvent]?

    struct CaptionEvent: Decodable {
        let segs: [CaptionSegment]?
    }

    struct CaptionSegment: Decodable {
        let utf8: String?
    }
}

// MARK: - Anki Exporter Plugin

@MainActor
class AnkiExporterPlugin: ExporterPlugin {
    let id = "com.aetherium.anki-exporter"
    let name = "Anki Deck Exporter"
    let description = "Export flashcards to Anki deck format"
    let version = "1.0.0"
    let author = "Aetherium"
    let icon = "rectangle.stack"
    let type: PluginType = .exporter

    let exportFormat = "Anki Deck"
    let fileExtension = "apkg"
    let supportsPartialExport = true

    func initialize() async throws {}
    func cleanup() async {}

    func exportProject(_ project: AetheriumProject, to url: URL, context: ModelContext) async throws {
        // Fetch all flashcards for project
        let projectId = project.id
        let descriptor = FetchDescriptor<LearningCard>(
            predicate: #Predicate { $0.project?.id == projectId }
        )

        guard let cards = try? context.fetch(descriptor) else {
            throw PluginError.executionFailed("Failed to fetch flashcards")
        }

        try await exportCards(cards, to: url)
    }

    func exportItems(_ items: [Any], to url: URL, context: ModelContext) async throws {
        let cards = items.compactMap { $0 as? LearningCard }
        try await exportCards(cards, to: url)
    }

    private func exportCards(_ cards: [LearningCard], to url: URL) async throws {
        // Generate Anki-compatible CSV format
        var csv = "Front,Back,Tags\n"

        for card in cards {
            let front = escapeCSV(card.front)
            let back = escapeCSV(card.back)
            let tags = card.tags.joined(separator: " ")

            csv += "\"\(front)\",\"\(back)\",\"\(tags)\"\n"
        }

        // Write CSV file (Anki can import CSV)
        let csvURL = url.deletingPathExtension().appendingPathExtension("csv")
        try csv.write(to: csvURL, atomically: true, encoding: .utf8)

        // Note: Full APKG export would require SQLite database creation
        // This CSV export is compatible with Anki's import function
    }

    private func escapeCSV(_ text: String) -> String {
        text.replacingOccurrences(of: "\"", with: "\"\"")
    }
}

// MARK: - Daily Summary Automation Plugin (Example)

@MainActor
class DailySummaryPlugin: AutomationPlugin {
    let id = "com.aetherium.daily-summary"
    let name = "Daily Summary"
    let description = "Auto-generate end-of-day summaries"
    let version = "1.0.0"
    let author = "Aetherium"
    let icon = "calendar.badge.clock"
    let type: PluginType = .automation

    let triggers: [AutomationTrigger] = [.dailySchedule, .manual]

    func initialize() async throws {}
    func cleanup() async {}

    func execute(
        trigger: AutomationTrigger,
        context: AutomationContext,
        modelContext: ModelContext
    ) async throws {
        guard let project = context.project else { return }

        // Get today's activity
        let today = Calendar.current.startOfDay(for: Date())

        // Find daily note
        let projectId = project.id
        let noteDescriptor = FetchDescriptor<DailyNote>(
            predicate: #Predicate { note in
                note.date == today && note.project?.id == projectId
            }
        )

        guard let dailyNote = try? modelContext.fetch(noteDescriptor).first else { return }

        // Generate summary
        var summary = "## Daily Summary\n\n"
        summary += "**Completed Tasks:** \(dailyNote.completedTasks.count)\n"
        summary += "**Learning Highlights:** \(dailyNote.learningHighlights.count)\n"

        if let productivity = dailyNote.productivity {
            summary += "**Productivity:** \(productivity)/10\n"
        }

        if let mood = dailyNote.mood {
            summary += "**Mood:** \(mood)\n"
        }

        // Append to daily note
        if let noteContent = dailyNote.note {
            noteContent.content += "\n\n---\n\n" + summary
        }
    }

    func configurationView() -> AnyView? {
        AnyView(
            VStack {
                Text("Daily Summary runs at end of day")
                Text("Summarizes activity, mood, and productivity")
            }
            .padding()
        )
    }
}
