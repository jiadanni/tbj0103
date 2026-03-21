import AppKit
import SwiftUI

enum ChatExportFormat: String, CaseIterable, Identifiable {
    case markdown = "Markdown"
    case json = "JSON"

    var id: String { rawValue }

    var fileExtension: String {
        switch self {
        case .markdown: return "md"
        case .json: return "json"
        }
    }
}

struct ChatExportSheet: View {
    let chatSession: ChatSession
    @Environment(\.dismiss) private var dismiss

    @State private var selectedFormat: ChatExportFormat = .markdown
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 20) {
            Text("Export Chat")
                .font(.headline)

            Picker("Format", selection: $selectedFormat) {
                ForEach(ChatExportFormat.allCases) { format in
                    Text(format.rawValue).tag(format)
                }
            }
            .pickerStyle(.segmented)

            if let error = errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
            }

            HStack {
                Button("Cancel") { dismiss() }
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.cancelAction)

                Button("Export") { exportChat() }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 350)
    }

    private func exportChat() {
        let panel = NSSavePanel()
        panel.allowedContentTypes = selectedFormat == .markdown
            ? [.init(filenameExtension: "md") ?? .plainText]
            : [.json]
        panel.nameFieldStringValue = "\(chatSession.title).\(selectedFormat.fileExtension)"

        guard panel.runModal() == .OK, let url = panel.url else { return }

        do {
            let content: String
            switch selectedFormat {
            case .markdown:
                content = buildMarkdown()
            case .json:
                content = try buildJSON()
            }
            try content.write(to: url, atomically: true, encoding: .utf8)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func buildMarkdown() -> String {
        let sorted = chatSession.messages.sorted { $0.timestamp < $1.timestamp }
        var md = "## \(chatSession.title)\n\n"
        md += "Model: \(chatSession.modelName)  \n"
        md += "Date: \(chatSession.createdAt.formatted(date: .long, time: .shortened))\n\n---\n\n"

        for msg in sorted {
            let role = msg.role == .user ? "**You:**" : "**AI:**"
            let time = msg.timestamp.formatted(date: .omitted, time: .shortened)
            md += "\(role) _\(time)_\n\n\(msg.content)\n\n"

            // Include citations if present
            if !msg.citations.isEmpty {
                md += "> **Sources:**\n"
                for c in msg.citations {
                    md += "> - \(c.sourceTitle)"
                    if let p = c.pageNumber { md += " (p. \(p))" }
                    md += ": \(c.excerpt)\n"
                }
                md += "\n"
            }
        }
        return md
    }

    private func buildJSON() throws -> String {
        struct ExportMessage: Codable {
            let role: String
            let content: String
            let timestamp: Date
            let citations: [ExportCitation]?
        }
        struct ExportCitation: Codable {
            let sourceTitle: String
            let sourceType: String
            let excerpt: String
            let relevanceScore: Double
            let pageNumber: Int?
        }
        struct ExportSession: Codable {
            let title: String
            let model: String
            let createdAt: Date
            let messages: [ExportMessage]
        }

        let sorted = chatSession.messages.sorted { $0.timestamp < $1.timestamp }
        let exportMessages = sorted.map { msg in
            ExportMessage(
                role: msg.role.rawValue,
                content: msg.content,
                timestamp: msg.timestamp,
                citations: msg.citations.isEmpty ? nil : msg.citations.map {
                    ExportCitation(
                        sourceTitle: $0.sourceTitle,
                        sourceType: $0.sourceType,
                        excerpt: $0.excerpt,
                        relevanceScore: $0.relevanceScore,
                        pageNumber: $0.pageNumber
                    )
                }
            )
        }
        let session = ExportSession(
            title: chatSession.title,
            model: chatSession.modelName,
            createdAt: chatSession.createdAt,
            messages: exportMessages
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(session)
        return String(data: data, encoding: .utf8) ?? "{}"
    }
}
