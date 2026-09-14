import { describe, expect, it } from "vitest";
import { parseMarkdownToHast } from "@/lib/markdownAst";

describe("parseMarkdownToHast caching", () => {
  it("returns the identical tree object on a repeat parse of the same content", () => {
    const content = "Inline math $E = mc^2$ and a **bold** word.";
    const first = parseMarkdownToHast(content);
    const second = parseMarkdownToHast(content);

    // Same object reference proves the remark/rehype/KaTeX pass was skipped,
    // which is the whole point of the cache for Virtuoso remounts.
    expect(second).toBe(first);
  });

  it("parses different content into different trees", () => {
    const a = parseMarkdownToHast("First message $x^2$");
    const b = parseMarkdownToHast("Second message $y^2$");

    expect(b).not.toBe(a);
    expect(JSON.stringify(b)).not.toEqual(JSON.stringify(a));
  });

  it("renders KaTeX markup for math content", () => {
    const tree = parseMarkdownToHast("$E = mc^2$");
    const serialized = JSON.stringify(tree);

    expect(serialized).toContain("katex");
  });

  it("produces a stable tree across repeated reads", () => {
    const content = "A [link](https://example.com) with $\\alpha$ math.";
    const first = JSON.stringify(parseMarkdownToHast(content));
    const second = JSON.stringify(parseMarkdownToHast(content));
    const third = JSON.stringify(parseMarkdownToHast(content));

    // The sanitise pass re-runs on every cached read, so it must be
    // idempotent — otherwise repeated scroll-by remounts would progressively
    // corrupt the cached tree.
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });
});

describe("parseMarkdownToHast sanitisation", () => {
  it("drops raw script tags", () => {
    const serialized = JSON.stringify(parseMarkdownToHast("<script>steal()</script>"));

    expect(serialized).not.toContain("steal()");
    expect(serialized).not.toContain("\"tagName\":\"script\"");
  });

  it("drops raw html event-handler attributes", () => {
    const serialized = JSON.stringify(parseMarkdownToHast("<img src=x onerror=steal()>"));

    expect(serialized).not.toContain("onerror");
  });

  it("blanks javascript: urls on links", () => {
    const serialized = JSON.stringify(parseMarkdownToHast("[bad](javascript:steal())"));

    expect(serialized).not.toContain("javascript:");
  });

  it("blanks javascript: urls on images", () => {
    const serialized = JSON.stringify(parseMarkdownToHast("![alt](javascript:steal())"));

    expect(serialized).not.toContain("javascript:");
  });

  it("preserves safe http and mailto urls", () => {
    const serialized = JSON.stringify(
      parseMarkdownToHast("[a](https://example.com) [b](mailto:x@example.com)"),
    );

    expect(serialized).toContain("https://example.com");
    expect(serialized).toContain("mailto:x@example.com");
  });

  it("keeps sanitisation applied after a cached re-read", () => {
    const content = "[bad](javascript:steal()) and <script>steal()</script>";
    parseMarkdownToHast(content);
    const serialized = JSON.stringify(parseMarkdownToHast(content));

    expect(serialized).not.toContain("javascript:");
    // The `<script>` markers are dropped; its inner text survives as an inert
    // text node, which is byte-for-byte what react-markdown's `skipHtml` does
    // for inline raw HTML (verified against `renderToStaticMarkup`). React
    // escapes text nodes, so there is no executable element here.
    expect(serialized).not.toContain("\"tagName\":\"script\"");
    expect(serialized).not.toContain("\"type\":\"raw\"");
  });
});
