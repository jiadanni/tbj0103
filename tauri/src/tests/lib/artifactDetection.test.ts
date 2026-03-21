import { describe, it, expect } from "vitest";
import { detectArtifacts } from "../../lib/artifactDetection";

describe("artifactDetection", () => {
  describe("Empty / no-match cases", () => {
    it("returns empty array for plain text with no code blocks", () => {
      const content = "Just some plain text here.";
      expect(detectArtifacts(content)).toEqual([]);
    });

    it("returns empty array for content with only inline code", () => {
      const content = "Use `const x = 5;` to define a variable.";
      expect(detectArtifacts(content)).toEqual([]);
    });

    it("ignores code blocks with < 5 lines and unknown language", () => {
      const content = "```typescript\nconst x = 1;\nconst y = 2;\n```";
      expect(detectArtifacts(content)).toEqual([]);
    });

    it("ignores code blocks with exactly 4 lines and type 'code'", () => {
      const content = "```typescript\nline 1\nline 2\nline 3\nline 4\n```";
      expect(detectArtifacts(content)).toEqual([]);
    });
  });

  describe("Inclusion rules", () => {
    it("includes code block with exactly 5 lines (boundary)", () => {
      const content = "```typescript\n1\n2\n3\n4\n5\n```";
      const result = detectArtifacts(content);
      expect(result).toHaveLength(1);
      expect(result[0].language).toBe("typescript");
    });

    it("includes code block with 6 lines", () => {
      const content = "```typescript\n1\n2\n3\n4\n5\n6\n```";
      const result = detectArtifacts(content);
      expect(result).toHaveLength(1);
    });

    it("includes mermaid block even with < 5 lines (diagram type bypass)", () => {
      const content = "```mermaid\ngraph TD;\nA-->B;\n```";
      const result = detectArtifacts(content);
      expect(result).toHaveLength(1);
      expect(result[0].artifact_type).toBe("diagram");
    });

    it("includes json block with 1 line (config type bypass)", () => {
      const content = "```json\n{\"key\": \"value\"}\n```";
      const result = detectArtifacts(content);
      expect(result).toHaveLength(1);
      expect(result[0].artifact_type).toBe("config");
    });

    it("maps yaml block to artifact_type: 'config'", () => {
      const content = "```yaml\nfoo: bar\n```";
      const result = detectArtifacts(content);
      expect(result[0].artifact_type).toBe("config");
    });

    it("maps sql block to artifact_type: 'data'", () => {
      const content = "```sql\nSELECT * FROM users;\n```";
      const result = detectArtifacts(content);
      expect(result[0].artifact_type).toBe("data");
    });

    it("maps unknown language block with 5 lines to artifact_type: 'code'", () => {
      const content = "```foobar\n1\n2\n3\n4\n5\n```";
      const result = detectArtifacts(content);
      expect(result[0].artifact_type).toBe("code");
    });

    it("handles no language specified (```) with 5 lines", () => {
      const content = "```\n1\n2\n3\n4\n5\n```";
      const result = detectArtifacts(content);
      expect(result[0].language).toBe("");
      expect(result[0].artifact_type).toBe("code");
    });
  });

  describe("Title heuristic", () => {
    it("extracts title from first line starting with //", () => {
      const content = "```typescript\n// filename.ts\nconst x = 1;\nconst y = 2;\nconst z = 3;\nconst w = 4;\n```";
      const result = detectArtifacts(content);
      expect(result[0].title).toBe("filename.ts");
    });

    it("extracts title from first line starting with #", () => {
      const content = "```yaml\n# config.yaml\nfoo: bar\n```";
      const result = detectArtifacts(content);
      expect(result[0].title).toBe("config.yaml");
    });

    it("extracts title from first line starting with /* ... */", () => {
      const content = "```typescript\n/* header.ts */\n1\n2\n3\n4\n5\n```";
      const result = detectArtifacts(content);
      expect(result[0].title).toBe("header.ts");
    });

    it("falls back to default title if first line comment is > 50 chars", () => {
      const longComment = "// " + "a".repeat(50);
      const content = `\`\`\`typescript\n${longComment}\n1\n2\n3\n4\n5\n\`\`\``;
      const result = detectArtifacts(content);
      expect(result[0].title).toBe("New typescript");
    });

    it("uses default title if no comment is found", () => {
      const content = "```json\n{\"foo\":\"bar\"}\n```";
      const result = detectArtifacts(content);
      expect(result[0].title).toBe("New config");
    });
  });

  describe("Multiple blocks", () => {
    it("returns both qualifying code blocks", () => {
      const content = `
\`\`\`json
{"a":1}
\`\`\`

\`\`\`mermaid
graph TD; A-->B;
\`\`\`
      `;
      const result = detectArtifacts(content);
      expect(result).toHaveLength(2);
      expect(result[0].artifact_type).toBe("config");
      expect(result[1].artifact_type).toBe("diagram");
    });

    it("returns only the qualifying one when one is too short", () => {
      const content = `
\`\`\`typescript
const x = 1;
\`\`\`

\`\`\`json
{"a":1}
\`\`\`
      `;
      const result = detectArtifacts(content);
      expect(result).toHaveLength(1);
      expect(result[0].artifact_type).toBe("config");
    });
  });

  describe("Content field", () => {
    it("returns trimmed content", () => {
      const content = "```json\n   {\"a\":1}   \n```";
      const result = detectArtifacts(content);
      expect(result[0].content).toBe("{\"a\":1}");
    });
  });
});
