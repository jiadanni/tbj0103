import SwiftUI
import SwiftData

// MARK: - Markdown Preview

struct MarkdownPreview: View {
    let text: String
    let project: AetheriumProject?

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
    }
}

#Preview {
    let sampleText = """
    # Getting Started with SwiftUI

    [[SwiftUI]] is a declarative framework for building user interfaces on Apple platforms.

    ## Key Concepts

    - **Views**: The basic building blocks
    - **State**: Managing dynamic data
    - **Bindings**: Two-way data flow

    Here's a simple example:

    ```swift
    struct ContentView: View {
        var body: some View {
            Text("Hello, SwiftUI!")
        }
    }
    ```

    > SwiftUI makes it easy to build adaptive UIs that work across all Apple platforms.

    You can learn more about [[Combine]] for reactive programming and [[Swift Concurrency]] for async operations.

    ## Advanced Topics

    Explore concepts like *property wrappers* and `@State` for managing UI state.
    """

    let config = ModelConfiguration(isStoredInMemoryOnly: true)
    let container = try! ModelContainer(for: AetheriumProject.self, configurations: config)

    let project = AetheriumProject(title: "Test", description: "Test")
    container.mainContext.insert(project)

    return MarkdownPreview(text: sampleText, project: project)
        .frame(width: 600, height: 700)
        .modelContainer(container)
}
