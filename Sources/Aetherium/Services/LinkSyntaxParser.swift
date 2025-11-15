import Foundation
import SwiftUI

// MARK: - Link Syntax Parser

/// Parses text for [[concept]] links and markdown syntax
@MainActor
class LinkSyntaxParser: ObservableObject {

    /// Detected link in text
    struct DetectedLink: Identifiable {
        let id = UUID()
        let range: NSRange
        let text: String
        let conceptName: String
        let isValid: Bool
    }

    /// Find all [[concept]] links in text
    func detectLinks(in text: String) -> [DetectedLink] {
        let pattern = #"\[\[([^\]]+)\]\]"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            return []
        }

        let nsString = text as NSString
        let matches = regex.matches(in: text, range: NSRange(location: 0, length: nsString.length))

        return matches.compactMap { match in
            guard match.numberOfRanges >= 2 else { return nil }

            let fullRange = match.range(at: 0)
            let conceptRange = match.range(at: 1)

            let fullText = nsString.substring(with: fullRange)
            let conceptName = nsString.substring(with: conceptRange)

            return DetectedLink(
                range: fullRange,
                text: fullText,
                conceptName: conceptName,
                isValid: !conceptName.isEmpty
            )
        }
    }

    /// Check if cursor is inside a link at given position
    func linkAtCursor(in text: String, position: Int) -> DetectedLink? {
        let links = detectLinks(in: text)
        return links.first { link in
            NSLocationInRange(position, link.range)
        }
    }

    /// Get partial concept name being typed (for autocomplete)
    func partialConceptAtCursor(in text: String, position: Int) -> (range: NSRange, partial: String)? {
        // Look backwards from cursor for opening [[
        let nsString = text as NSString

        guard position <= nsString.length else { return nil }

        // Search backwards for [[
        var searchPos = position - 1
        var foundOpening = false
        var openingPos = 0

        while searchPos >= 0 {
            if searchPos < nsString.length - 1 {
                let chars = nsString.substring(with: NSRange(location: searchPos, length: 2))
                if chars == "[[" {
                    foundOpening = true
                    openingPos = searchPos
                    break
                }
            }

            // If we hit closing ]], stop (we're not in a link)
            if searchPos < nsString.length - 1 {
                let chars = nsString.substring(with: NSRange(location: searchPos, length: 2))
                if chars == "]]" {
                    return nil
                }
            }

            searchPos -= 1
        }

        guard foundOpening else { return nil }

        // Extract partial text from [[ to cursor
        let partialStart = openingPos + 2
        let partialLength = position - partialStart

        guard partialLength >= 0 else { return nil }

        let partialRange = NSRange(location: partialStart, length: partialLength)
        let partial = nsString.substring(with: partialRange)

        return (range: partialRange, partial: partial)
    }

    /// Apply syntax highlighting to attributed string
    func applySyntaxHighlighting(to text: String) -> AttributedString {
        var attributed = AttributedString(text)
        let links = detectLinks(in: text)

        for link in links {
            if let range = Range(link.range, in: text) {
                let attributedRange = AttributedString.Index(range.lowerBound, within: attributed)..<AttributedString.Index(range.upperBound, within: attributed)

                if attributedRange.lowerBound < attributed.endIndex && attributedRange.upperBound <= attributed.endIndex {
                    attributed[attributedRange].foregroundColor = link.isValid ? .blue : .orange
                    attributed[attributedRange].font = .body.weight(.medium)
                }
            }
        }

        return attributed
    }

    /// Extract plain concept names from text
    func extractConceptNames(from text: String) -> [String] {
        let links = detectLinks(in: text)
        return links.map { $0.conceptName }
    }
}

// MARK: - Markdown Syntax Elements

extension LinkSyntaxParser {

    /// Detect markdown headers
    func detectHeaders(in text: String) -> [NSRange] {
        let pattern = #"^#{1,6}\s+.+$"#
        return detectPattern(pattern, in: text)
    }

    /// Detect markdown bold (**text** or __text__)
    func detectBold(in text: String) -> [NSRange] {
        let pattern = #"\*\*[^\*]+\*\*|__[^_]+__"#
        return detectPattern(pattern, in: text)
    }

    /// Detect markdown italic (*text* or _text_)
    func detectItalic(in text: String) -> [NSRange] {
        let pattern = #"\*[^\*]+\*|_[^_]+_"#
        return detectPattern(pattern, in: text)
    }

    /// Detect markdown code (`code`)
    func detectInlineCode(in text: String) -> [NSRange] {
        let pattern = #"`[^`]+`"#
        return detectPattern(pattern, in: text)
    }

    /// Detect markdown lists
    func detectLists(in text: String) -> [NSRange] {
        let pattern = #"^[\s]*[-*+]\s+.+$|^[\s]*\d+\.\s+.+$"#
        return detectPattern(pattern, in: text, options: .anchorsMatchLines)
    }

    private func detectPattern(_ pattern: String, in text: String, options: NSRegularExpression.Options = []) -> [NSRange] {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else {
            return []
        }

        let nsString = text as NSString
        let matches = regex.matches(in: text, range: NSRange(location: 0, length: nsString.length))
        return matches.map { $0.range }
    }
}
