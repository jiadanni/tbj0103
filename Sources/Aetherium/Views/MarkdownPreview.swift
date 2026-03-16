import SwiftUI
import SwiftData

// MARK: - Markdown Preview

struct MarkdownPreview: View {
    let text: String
    let project: Workspace?

    @StateObject private var parser = LinkSyntaxParser()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(parseBlocks(), id: \.id) { block in
                    renderBlock(block)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color(NSColor.textBackgroundColor))
    }

    // MARK: - Block Parsing

    private func parseBlocks() -> [MarkdownBlock] {
        let lines = text.components(separatedBy: .newlines)
        var blocks: [MarkdownBlock] = []
        var currentParagraph: [String] = []

        for line in lines {
            if line.isEmpty {
                // End current paragraph
                if !currentParagraph.isEmpty {
                    blocks.append(MarkdownBlock(
                        type: .paragraph,
                        content: currentParagraph.joined(separator: "\n")
                    ))
                    currentParagraph = []
                }
            } else if line.hasPrefix("#") {
                // Header
                flushParagraph(&currentParagraph, to: &blocks)
                let level = line.prefix(while: { $0 == "#" }).count
                let content = line.dropFirst(level).trimmingCharacters(in: .whitespaces)
                blocks.append(MarkdownBlock(type: .header(level), content: content))
            } else if line.trimmingCharacters(in: .whitespaces).hasPrefix("-") ||
                      line.trimmingCharacters(in: .whitespaces).hasPrefix("*") ||
                      line.trimmingCharacters(in: .whitespaces).hasPrefix("+") {
                // List item
                flushParagraph(&currentParagraph, to: &blocks)
                let content = line.trimmingCharacters(in: .whitespaces).dropFirst().trimmingCharacters(in: .whitespaces)
                blocks.append(MarkdownBlock(type: .listItem, content: content))
            } else if line.hasPrefix("```") {
                // Code block
                flushParagraph(&currentParagraph, to: &blocks)
                blocks.append(MarkdownBlock(type: .codeBlock, content: line))
            } else if line.hasPrefix(">") {
                // Blockquote
                flushParagraph(&currentParagraph, to: &blocks)
                let content = line.dropFirst().trimmingCharacters(in: .whitespaces)
                blocks.append(MarkdownBlock(type: .blockquote, content: content))
            } else {
                // Regular text - accumulate into paragraph
                currentParagraph.append(line)
            }
        }

        // Flush remaining paragraph
        flushParagraph(&currentParagraph, to: &blocks)

        return blocks
    }

    private func flushParagraph(_ paragraph: inout [String], to blocks: inout [MarkdownBlock]) {
        if !paragraph.isEmpty {
            blocks.append(MarkdownBlock(
                type: .paragraph,
                content: paragraph.joined(separator: "\n")
            ))
            paragraph = []
        }
    }

    // MARK: - Block Rendering

    @ViewBuilder
    private func renderBlock(_ block: MarkdownBlock) -> some View {
        switch block.type {
        case .header(let level):
            renderHeader(block.content, level: level)

        case .paragraph:
            renderParagraph(block.content)

        case .listItem:
            renderListItem(block.content)

        case .codeBlock:
            renderCodeBlock(block.content)

        case .blockquote:
            renderBlockquote(block.content)

        case .horizontalRule:
            Divider()

        case .numberedListItem(let num):
            HStack(alignment: .top, spacing: 8) {
                Text("\(num).")
                    .font(.body)
                    .foregroundColor(.secondary)
                    .monospacedDigit()
                renderInlineMarkdown(block.content)
                    .font(.body)
            }
        }
    }

    private func renderHeader(_ text: String, level: Int) -> some View {
        renderInlineMarkdown(text)
            .font(fontForHeaderLevel(level))
            .fontWeight(.bold)
            .padding(.top, level == 1 ? 8 : 4)
    }

    private func renderParagraph(_ text: String) -> some View {
        renderInlineMarkdown(text)
            .font(.body)
    }

    private func renderListItem(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text("•")
                .font(.body)
                .foregroundColor(.secondary)

            renderInlineMarkdown(text)
                .font(.body)
        }
    }

    private func renderCodeBlock(_ text: String) -> some View {
        Text(text)
            .font(.system(.body, design: .monospaced))
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.secondary.opacity(0.1))
            .cornerRadius(8)
    }

    private func renderBlockquote(_ text: String) -> some View {
        HStack(spacing: 12) {
            Rectangle()
                .fill(Color.blue.opacity(0.5))
                .frame(width: 4)

            renderInlineMarkdown(text)
                .font(.body.italic())
                .foregroundColor(.secondary)
        }
        .padding(.leading, 8)
    }

    // MARK: - Inline Markdown Rendering

    @ViewBuilder
    private func renderInlineMarkdown(_ text: String) -> some View {
        let components = parseInlineComponents(text)

        if components.isEmpty {
            Text(text)
        } else {
            components.reduce(Text("")) { result, component in
                result + component
            }
        }
    }

    private func parseInlineComponents(_ text: String) -> [Text] {
        var components: [Text] = []
        var currentText = ""
        var index = text.startIndex

        while index < text.endIndex {
            // Check for [[concept]] links
            if index < text.index(text.endIndex, offsetBy: -3),
               text[index..<text.index(index, offsetBy: 2)] == "[[" {
                // Flush current text
                if !currentText.isEmpty {
                    components.append(Text(currentText))
                    currentText = ""
                }

                // Find closing ]]
                if let endIndex = text[index...].range(of: "]]")?.lowerBound {
                    let conceptName = String(text[text.index(index, offsetBy: 2)..<endIndex])
                    components.append(
                        Text(conceptName)
                            .foregroundColor(.blue)
                            .underline()
                    )
                    index = text.index(endIndex, offsetBy: 2)
                    continue
                }
            }

            // Check for **bold**
            if index < text.index(text.endIndex, offsetBy: -4),
               text[index..<text.index(index, offsetBy: 2)] == "**" {
                if !currentText.isEmpty {
                    components.append(Text(currentText))
                    currentText = ""
                }

                if let endIndex = text[text.index(index, offsetBy: 2)...].range(of: "**")?.lowerBound {
                    let boldText = String(text[text.index(index, offsetBy: 2)..<endIndex])
                    components.append(Text(boldText).bold())
                    index = text.index(endIndex, offsetBy: 2)
                    continue
                }
            }

            // Check for *italic*
            if index < text.index(text.endIndex, offsetBy: -2),
               text[index] == "*",
               text[text.index(after: index)] != "*" {
                if !currentText.isEmpty {
                    components.append(Text(currentText))
                    currentText = ""
                }

                if let endIndex = text[text.index(after: index)...].range(of: "*")?.lowerBound {
                    let italicText = String(text[text.index(after: index)..<endIndex])
                    components.append(Text(italicText).italic())
                    index = text.index(after: endIndex)
                    continue
                }
            }

            // Check for `code`
            if index < text.index(text.endIndex, offsetBy: -2),
               text[index] == "`" {
                if !currentText.isEmpty {
                    components.append(Text(currentText))
                    currentText = ""
                }

                if let endIndex = text[text.index(after: index)...].range(of: "`")?.lowerBound {
                    let codeText = String(text[text.index(after: index)..<endIndex])
                    components.append(
                        Text(codeText)
                            .font(.system(.body, design: .monospaced))
                            .foregroundColor(.purple)
                    )
                    index = text.index(after: endIndex)
                    continue
                }
            }

            // Regular character
            currentText.append(text[index])
            index = text.index(after: index)
        }

        // Flush remaining text
        if !currentText.isEmpty {
            components.append(Text(currentText))
        }

        return components
    }

    // MARK: - Helpers

    private func fontForHeaderLevel(_ level: Int) -> Font {
        switch level {
        case 1: return .largeTitle
        case 2: return .title
        case 3: return .title2
        case 4: return .title3
        case 5: return .headline
        default: return .body
        }
    }
}

// MARK: - Markdown Block Type

struct MarkdownBlock: Identifiable {
    let id = UUID()
    let type: BlockType
    let content: String

    enum BlockType {
        case header(Int)
        case paragraph
        case listItem
        case codeBlock
        case blockquote
        case horizontalRule
        case numberedListItem(Int)
    }
}

// MARK: - Markdown Message View (for chat bubbles)

struct MarkdownMessageView: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(parseBlocks(), id: \.id) { block in
                renderBlock(block)
            }
        }
    }

    // MARK: - Block Parsing (with proper code fence handling)

    private func parseBlocks() -> [MarkdownBlock] {
        let lines = text.components(separatedBy: "\n")
        var blocks: [MarkdownBlock] = []
        var currentParagraph: [String] = []
        var inCodeBlock = false
        var codeLines: [String] = []

        for line in lines {
            // Handle code fences
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                if inCodeBlock {
                    // Closing fence
                    blocks.append(MarkdownBlock(
                        type: .codeBlock,
                        content: codeLines.joined(separator: "\n")
                    ))
                    codeLines = []
                    inCodeBlock = false
                } else {
                    // Opening fence
                    flushParagraph(&currentParagraph, to: &blocks)
                    inCodeBlock = true
                }
                continue
            }

            if inCodeBlock {
                codeLines.append(line)
                continue
            }

            // Horizontal rule
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed == "---" || trimmed == "***" || trimmed == "___" {
                flushParagraph(&currentParagraph, to: &blocks)
                blocks.append(MarkdownBlock(type: .horizontalRule, content: ""))
                continue
            }

            if line.isEmpty {
                if !currentParagraph.isEmpty {
                    blocks.append(MarkdownBlock(
                        type: .paragraph,
                        content: currentParagraph.joined(separator: "\n")
                    ))
                    currentParagraph = []
                }
            } else if line.hasPrefix("#") {
                flushParagraph(&currentParagraph, to: &blocks)
                let level = line.prefix(while: { $0 == "#" }).count
                let content = line.dropFirst(level).trimmingCharacters(in: .whitespaces)
                blocks.append(MarkdownBlock(type: .header(level), content: content))
            } else if let range = trimmed.range(of: #"^\d+\.\s+"#, options: .regularExpression) {
                flushParagraph(&currentParagraph, to: &blocks)
                let prefix = trimmed[range]
                let numStr = prefix.prefix(while: { $0.isNumber })
                let num = Int(numStr) ?? 1
                let content = String(trimmed[range.upperBound...])
                blocks.append(MarkdownBlock(type: .numberedListItem(num), content: content))
            } else if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") || trimmed.hasPrefix("+ ") {
                flushParagraph(&currentParagraph, to: &blocks)
                let content = trimmed.dropFirst(2).trimmingCharacters(in: .whitespaces)
                blocks.append(MarkdownBlock(type: .listItem, content: content))
            } else if line.hasPrefix(">") {
                flushParagraph(&currentParagraph, to: &blocks)
                let content = line.dropFirst().trimmingCharacters(in: .whitespaces)
                blocks.append(MarkdownBlock(type: .blockquote, content: content))
            } else {
                currentParagraph.append(line)
            }
        }

        // Flush remaining
        if inCodeBlock && !codeLines.isEmpty {
            blocks.append(MarkdownBlock(type: .codeBlock, content: codeLines.joined(separator: "\n")))
        }
        flushParagraph(&currentParagraph, to: &blocks)

        return blocks
    }

    private func flushParagraph(_ paragraph: inout [String], to blocks: inout [MarkdownBlock]) {
        if !paragraph.isEmpty {
            blocks.append(MarkdownBlock(
                type: .paragraph,
                content: paragraph.joined(separator: "\n")
            ))
            paragraph = []
        }
    }

    // MARK: - Block Rendering

    @ViewBuilder
    private func renderBlock(_ block: MarkdownBlock) -> some View {
        switch block.type {
        case .header(let level):
            renderInlineMarkdown(block.content)
                .font(fontForHeader(level))
                .fontWeight(.bold)
                .padding(.top, level <= 2 ? 4 : 2)

        case .paragraph:
            renderInlineMarkdown(block.content)
                .font(.body)

        case .listItem:
            HStack(alignment: .top, spacing: 6) {
                Text("\u{2022}")
                    .foregroundColor(.secondary)
                renderInlineMarkdown(block.content)
                    .font(.body)
            }
            .padding(.leading, 8)

        case .numberedListItem(let num):
            HStack(alignment: .top, spacing: 6) {
                Text("\(num).")
                    .foregroundColor(.secondary)
                    .monospacedDigit()
                renderInlineMarkdown(block.content)
                    .font(.body)
            }
            .padding(.leading, 8)

        case .codeBlock:
            ScrollView(.horizontal, showsIndicators: false) {
                Text(block.content)
                    .font(.system(.callout, design: .monospaced))
                    .textSelection(.enabled)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(nsColor: .textBackgroundColor).opacity(0.6))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
            )
            .cornerRadius(6)

        case .blockquote:
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 1)
                    .fill(Color.blue.opacity(0.5))
                    .frame(width: 3)

                renderInlineMarkdown(block.content)
                    .font(.body)
                    .italic()
                    .foregroundColor(.secondary)
            }
            .padding(.leading, 4)

        case .horizontalRule:
            Divider()
                .padding(.vertical, 4)
        }
    }

    // MARK: - Inline Markdown

    @ViewBuilder
    private func renderInlineMarkdown(_ text: String) -> some View {
        let components = parseInline(text)
        if components.isEmpty {
            Text(text)
        } else {
            components.reduce(Text("")) { $0 + $1 }
        }
    }

    private func parseInline(_ text: String) -> [Text] {
        var components: [Text] = []
        var current = ""
        var i = text.startIndex

        while i < text.endIndex {
            let remaining = text[i...]

            // **bold**
            if remaining.hasPrefix("**"),
               let end = text[text.index(i, offsetBy: 2)...].range(of: "**")?.lowerBound {
                if !current.isEmpty { components.append(Text(current)); current = "" }
                let bold = String(text[text.index(i, offsetBy: 2)..<end])
                components.append(Text(bold).bold())
                i = text.index(end, offsetBy: 2)
                continue
            }

            // *italic* (but not **)
            if text[i] == "*",
               i < text.index(before: text.endIndex),
               text[text.index(after: i)] != "*",
               let end = text[text.index(after: i)...].range(of: "*")?.lowerBound {
                if !current.isEmpty { components.append(Text(current)); current = "" }
                let italic = String(text[text.index(after: i)..<end])
                components.append(Text(italic).italic())
                i = text.index(after: end)
                continue
            }

            // `code`
            if text[i] == "`",
               i < text.index(before: text.endIndex),
               let end = text[text.index(after: i)...].range(of: "`")?.lowerBound {
                if !current.isEmpty { components.append(Text(current)); current = "" }
                let code = String(text[text.index(after: i)..<end])
                components.append(
                    Text(code)
                        .font(.system(.body, design: .monospaced))
                        .foregroundColor(.purple)
                )
                i = text.index(after: end)
                continue
            }

            // [[concept]]
            if remaining.hasPrefix("[["),
               let end = text[text.index(i, offsetBy: 2)...].range(of: "]]")?.lowerBound {
                if !current.isEmpty { components.append(Text(current)); current = "" }
                let concept = String(text[text.index(i, offsetBy: 2)..<end])
                components.append(Text(concept).foregroundColor(.blue).underline())
                i = text.index(end, offsetBy: 2)
                continue
            }

            current.append(text[i])
            i = text.index(after: i)
        }

        if !current.isEmpty { components.append(Text(current)) }
        return components
    }

    private func fontForHeader(_ level: Int) -> Font {
        switch level {
        case 1: return .title
        case 2: return .title2
        case 3: return .title3
        case 4: return .headline
        default: return .subheadline
        }
    }
}
