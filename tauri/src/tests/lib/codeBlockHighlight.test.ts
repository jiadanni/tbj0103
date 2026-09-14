import { describe, expect, it } from "vitest";
import { tokenizeCode } from "@/lib/codeBlockHighlight";

describe("tokenizeCode caching", () => {
  it("returns equivalent tokens on repeated calls for the same code and language", () => {
    const code = "function add(a, b) {\n  return a + b;\n}";
    const first = tokenizeCode(code, "javascript");
    const second = tokenizeCode(code, "javascript");

    expect(second).toEqual(first);
  });

  it("does not cross-contaminate cache entries across languages for identical source text", () => {
    const code = "def add(a, b):\n    return a + b";
    const python = tokenizeCode(code, "python");
    const asJs = tokenizeCode(code, "javascript");

    expect(python).not.toEqual(asJs);
  });

  it("re-tokenizes when the code content changes", () => {
    const before = tokenizeCode("const x = 1;", "javascript");
    const after = tokenizeCode("const x = 2;", "javascript");

    expect(after).not.toEqual(before);
  });
});
