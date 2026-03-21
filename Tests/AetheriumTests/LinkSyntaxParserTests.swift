@testable import Aetherium
import XCTest

@MainActor
final class LinkSyntaxParserTests: XCTestCase {
    
    var parser: LinkSyntaxParser!

    override func setUp() async throws {
        parser = LinkSyntaxParser()
    }

    override func tearDown() async throws {
        parser = nil
    }

    func testDetectLinks() {
        let text = "This is a [[test concept]] and another [[link]] here."
        let links = parser.detectLinks(in: text)
        
        XCTAssertEqual(links.count, 2)
        XCTAssertEqual(links[0].conceptName, "test concept")
        XCTAssertEqual(links[1].conceptName, "link")
        XCTAssertTrue(links[0].isValid)
    }

    func testDetectLinksEmptyBrackets() {
        let text = "This is a [[]] empty link."
        let links = parser.detectLinks(in: text)
        
        // The regex `\[\[([^\]]+)\]\]` requires at least one character inside brackets,
        // so `[[]]` should produce 0 matches.
        XCTAssertEqual(links.count, 0)
    }

    func testExtractConceptNames() {
        let text = "Learn about [[SwiftUI]] and [[SwiftData]]."
        let concepts = parser.extractConceptNames(from: text)
        
        XCTAssertEqual(concepts, ["SwiftUI", "SwiftData"])
    }

    func testPartialConceptAtCursor() {
        let text = "I am typing [[conc"
        // Cursor is at the end of the string. Length of text is 18
        if let match = parser.partialConceptAtCursor(in: text, position: text.count) {
            XCTAssertEqual(match.partial, "conc")
        } else {
            XCTFail("Failed to detect partial concept")
        }
    }

    func testPartialConceptAtCursorNotMatches() {
        let text = "I finished typing [[concept]] "
        let match = parser.partialConceptAtCursor(in: text, position: text.count)
        XCTAssertNil(match)
    }

    func testDetectHeaders() {
        let text = """
        # Header 1
        Some text
        ## Header 2
        More text
        """
        
        let headers = parser.detectHeaders(in: text)
        XCTAssertEqual(headers.count, 2)
    }

    func testDetectBold() {
        let text = "This is **bold** and __also bold__."
        let bolds = parser.detectBold(in: text)
        XCTAssertEqual(bolds.count, 2)
    }
    
    func testDetectItalic() {
        let text = "This is *italic* and _also italic_."
        let italics = parser.detectItalic(in: text)
        XCTAssertEqual(italics.count, 2)
    }
    
    func testDetectInlineCode() {
        let text = "Use `print()` to output text."
        let code = parser.detectInlineCode(in: text)
        XCTAssertEqual(code.count, 1)
    }
    
    func testDetectLists() {
        let text = """
        - Item 1
        * Item 2
        1. Item 3
        """
        let lists = parser.detectLists(in: text)
        XCTAssertEqual(lists.count, 3)
    }
}
