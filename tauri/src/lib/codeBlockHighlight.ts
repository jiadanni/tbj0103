export type CodeBlockContainerStyle = "rounded" | "roundedExpanded" | "compactHeader" | "utilityHeader";
export type CodeBlockColorPalette = "balanced" | "vivid" | "muted" | "warm";
export type CodeBlockKeywordColor = "preset" | "accent" | "blue" | "violet" | "emerald" | "amber" | "rose";
export type CodeTokenKind = "plain" | "keyword" | "string" | "comment" | "number" | "function";

export const CODE_BLOCK_CONTAINER_STYLES: Array<{ id: CodeBlockContainerStyle; label: string; description: string }> = [
  { id: "rounded", label: "Rounded", description: "Compact rounded card with icon actions" },
  { id: "roundedExpanded", label: "Roomy", description: "Full-width rounded canvas for longer code" },
  { id: "compactHeader", label: "Compact", description: "Tight header with icon actions" },
  { id: "utilityHeader", label: "Toolbar", description: "Top bar with text actions" },
];

export const CODE_BLOCK_COLOR_PALETTES: Array<{
  id: CodeBlockColorPalette;
  label: string;
  colors: Record<CodeTokenKind, string>;
}> = [
  {
    id: "balanced",
    label: "Balanced",
    colors: { plain: "#f4f4f5", keyword: "#a78bfa", string: "#86efac", comment: "#7a7a7a", number: "#f9a8d4", function: "#fde047" },
  },
  {
    id: "vivid",
    label: "Vivid",
    colors: { plain: "#f8fafc", keyword: "#60a5fa", string: "#34d399", comment: "#8b8b8b", number: "#f472b6", function: "#facc15" },
  },
  {
    id: "muted",
    label: "Muted",
    colors: { plain: "#e5e7eb", keyword: "#c084fc", string: "#8dd3a7", comment: "#737373", number: "#f0abfc", function: "#e5d283" },
  },
  {
    id: "warm",
    label: "Warm",
    colors: { plain: "#f5f5f4", keyword: "#fdba74", string: "#bef264", comment: "#78716c", number: "#fda4af", function: "#fef08a" },
  },
];

export const CODE_BLOCK_KEYWORD_COLORS: Array<{ id: CodeBlockKeywordColor; label: string; value: string | null }> = [
  { id: "preset", label: "Preset", value: null },
  { id: "accent", label: "Accent", value: "var(--accent-color)" },
  { id: "blue", label: "Blue", value: "#60a5fa" },
  { id: "violet", label: "Violet", value: "#a78bfa" },
  { id: "emerald", label: "Emerald", value: "#34d399" },
  { id: "amber", label: "Amber", value: "#fbbf24" },
  { id: "rose", label: "Rose", value: "#fb7185" },
];

const CODE_BLOCK_CONTAINER_STYLE_IDS = new Set(CODE_BLOCK_CONTAINER_STYLES.map((style) => style.id));
const CODE_BLOCK_COLOR_PALETTE_IDS = new Set(CODE_BLOCK_COLOR_PALETTES.map((palette) => palette.id));
const CODE_BLOCK_KEYWORD_COLOR_IDS = new Set(CODE_BLOCK_KEYWORD_COLORS.map((color) => color.id));

const KEYWORDS_BY_LANGUAGE: Record<string, string[]> = {
  bash: ["case", "do", "done", "elif", "else", "esac", "fi", "for", "function", "if", "in", "select", "then", "until", "while"],
  c: ["auto", "break", "case", "const", "continue", "default", "do", "else", "enum", "extern", "for", "goto", "if", "inline", "return", "sizeof", "static", "struct", "switch", "typedef", "union", "volatile", "while"],
  cpp: ["auto", "break", "case", "class", "const", "constexpr", "continue", "default", "delete", "do", "else", "enum", "explicit", "extern", "for", "friend", "if", "inline", "namespace", "new", "operator", "private", "protected", "public", "return", "sizeof", "static", "struct", "switch", "template", "this", "typedef", "typename", "using", "virtual", "volatile", "while"],
  css: ["and", "from", "import", "media", "not", "only", "supports", "to"],
  go: ["break", "case", "chan", "const", "continue", "default", "defer", "else", "fallthrough", "for", "func", "go", "goto", "if", "import", "interface", "map", "package", "range", "return", "select", "struct", "switch", "type", "var"],
  java: ["abstract", "break", "case", "catch", "class", "const", "continue", "default", "do", "else", "enum", "extends", "final", "finally", "for", "if", "implements", "import", "instanceof", "interface", "new", "package", "private", "protected", "public", "return", "static", "super", "switch", "this", "throw", "throws", "try", "void", "while"],
  javascript: ["await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "export", "extends", "finally", "for", "from", "function", "if", "import", "in", "instanceof", "let", "new", "of", "return", "static", "super", "switch", "this", "throw", "try", "typeof", "var", "void", "while", "yield"],
  json: ["false", "null", "true"],
  python: ["and", "as", "assert", "async", "await", "break", "case", "class", "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "match", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield"],
  rust: ["as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum", "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct", "super", "trait", "true", "type", "unsafe", "use", "where", "while"],
  sql: ["alter", "and", "as", "asc", "begin", "between", "by", "case", "commit", "constraint", "create", "delete", "desc", "distinct", "drop", "else", "end", "exists", "foreign", "from", "group", "having", "in", "index", "insert", "into", "join", "key", "left", "like", "limit", "not", "null", "on", "or", "order", "primary", "references", "right", "rollback", "select", "set", "table", "then", "union", "unique", "update", "values", "when", "where"],
  typescript: ["abstract", "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "declare", "default", "delete", "do", "else", "enum", "export", "extends", "finally", "for", "from", "function", "if", "implements", "import", "in", "infer", "interface", "keyof", "let", "namespace", "new", "of", "private", "protected", "public", "readonly", "return", "satisfies", "static", "super", "switch", "this", "throw", "try", "type", "typeof", "var", "void", "while", "yield"],
};

const LANGUAGE_ALIASES: Record<string, string> = {
  cxx: "cpp",
  h: "c",
  hpp: "cpp",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "typescript",
};

export function normalizeCodeBlockContainerStyle(style: unknown): CodeBlockContainerStyle {
  return typeof style === "string" && CODE_BLOCK_CONTAINER_STYLE_IDS.has(style as CodeBlockContainerStyle)
    ? style as CodeBlockContainerStyle
    : "rounded";
}

export function normalizeCodeBlockColorPalette(palette: unknown): CodeBlockColorPalette {
  return typeof palette === "string" && CODE_BLOCK_COLOR_PALETTE_IDS.has(palette as CodeBlockColorPalette)
    ? palette as CodeBlockColorPalette
    : "balanced";
}

export function normalizeCodeBlockKeywordColor(color: unknown): CodeBlockKeywordColor {
  return typeof color === "string" && CODE_BLOCK_KEYWORD_COLOR_IDS.has(color as CodeBlockKeywordColor)
    ? color as CodeBlockKeywordColor
    : "preset";
}

export function getCodeBlockColorPaletteColors(palette: CodeBlockColorPalette): Record<CodeTokenKind, string> {
  return CODE_BLOCK_COLOR_PALETTES.find((option) => option.id === palette)?.colors ?? CODE_BLOCK_COLOR_PALETTES[0].colors;
}

export function getCodeBlockKeywordColorValue(color: CodeBlockKeywordColor, palette: CodeBlockColorPalette): string {
  if (color === "preset") {
    return getCodeBlockColorPaletteColors(palette).keyword;
  }
  return CODE_BLOCK_KEYWORD_COLORS.find((option) => option.id === color)?.value ?? getCodeBlockColorPaletteColors(palette).keyword;
}

export function tokenizeCode(code: string, language: string): Array<{ text: string; kind: CodeTokenKind }> {
  const normalizedLanguage = LANGUAGE_ALIASES[language.toLowerCase()] ?? language.toLowerCase();
  const keywords = KEYWORDS_BY_LANGUAGE[normalizedLanguage];
  const keywordSet = new Set(keywords ?? []);
  const tokens: Array<{ text: string; kind: CodeTokenKind }> = [];
  let index = 0;

  while (index < code.length) {
    const rest = code.slice(index);

    const lineCommentPrefix = normalizedLanguage === "python" || normalizedLanguage === "bash" ? "#" : normalizedLanguage === "sql" ? "--" : "//";
    if (rest.startsWith(lineCommentPrefix)) {
      const nextLine = code.indexOf("\n", index);
      const end = nextLine === -1 ? code.length : nextLine;
      tokens.push({ text: code.slice(index, end), kind: "comment" });
      index = end;
      continue;
    }

    if (rest.startsWith("/*")) {
      const end = code.indexOf("*/", index + 2);
      const commentEnd = end === -1 ? code.length : end + 2;
      tokens.push({ text: code.slice(index, commentEnd), kind: "comment" });
      index = commentEnd;
      continue;
    }

    const char = code[index];
    if (char === "\"" || char === "'" || char === "`") {
      const quote = char;
      let end = index + 1;
      while (end < code.length) {
        if (code[end] === "\\") {
          end += 2;
          continue;
        }
        if (code[end] === quote) {
          end += 1;
          break;
        }
        end += 1;
      }
      tokens.push({ text: code.slice(index, end), kind: "string" });
      index = end;
      continue;
    }

    const numberMatch = /^\b\d+(?:\.\d+)?\b/.exec(rest);
    if (numberMatch) {
      tokens.push({ text: numberMatch[0], kind: "number" });
      index += numberMatch[0].length;
      continue;
    }

    const identifierMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (identifierMatch) {
      const text = identifierMatch[0];
      const after = code.slice(index + text.length);
      const kind = keywordSet.has(text)
        ? "keyword"
        : /^\s*\(/.test(after)
          ? "function"
          : "plain";
      tokens.push({ text, kind });
      index += text.length;
      continue;
    }

    tokens.push({ text: char, kind: "plain" });
    index += 1;
  }

  return tokens.length ? tokens : [{ text: code, kind: "plain" }];
}

export function tokenizeCodeKeywords(code: string, language: string): Array<{ text: string; keyword: boolean }> {
  return tokenizeCode(code, language).map((token) => ({ text: token.text, keyword: token.kind === "keyword" }));
}
