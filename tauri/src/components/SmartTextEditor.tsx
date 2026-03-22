/**
 * SmartTextEditor — CodeMirror 6 editor with [[wiki-link]] highlighting
 * and autocomplete for concept names.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import CodeMirror, { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { keymap } from "@codemirror/view";
import {
  autocompletion, CompletionContext, CompletionResult,
} from "@codemirror/autocomplete";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { api } from "../lib/api";
import { useScopedWorkspace } from "../lib/workspacePane";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
  autofocus?: boolean;
}

// ---------- Wiki-link decoration plugin ----------
const wikiLinkMark = Decoration.mark({ class: "wiki-link" });

function buildWikiDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const pattern = /\[\[[^\]]+\]\]/g;
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    let m;
    while ((m = pattern.exec(text)) !== null) {
      builder.add(from + m.index, from + m.index + m[0].length, wikiLinkMark);
    }
  }
  return builder.finish();
}

const wikiLinkPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildWikiDecorations(view); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged)
        {this.decorations = buildWikiDecorations(update.view);}
    }
  },
  { decorations: (v) => v.decorations }
);

// ---------- Autocomplete for [[concept]] completions ----------
function makeConceptCompleter(conceptNames: string[]) {
  return (context: CompletionContext): CompletionResult | null => {
    // Match [[partial
    const match = context.matchBefore(/\[\[[^\]]*$/);
    if (!match) {return null;}
    const partial = match.text.slice(2).toLowerCase();
    const options = conceptNames
      .filter((n) => n.toLowerCase().includes(partial))
      .slice(0, 20)
      .map((n) => ({ label: n, apply: `[[${n}]]` }));
    return { from: match.from, options };
  };
}

export default function SmartTextEditor({
  value, onChange, placeholder = "Write something…", minHeight = "200px", autofocus = false,
}: Props) {
  const { activeWorkspaceId } = useScopedWorkspace();
  const [conceptNames, setConceptNames] = useState<string[]>([]);

  // Load concept names for autocomplete
  useEffect(() => {
    if (!activeWorkspaceId) {return;}
    api.graph.listConcepts(activeWorkspaceId)
      .then((concepts) => { setConceptNames(concepts.map((c) => c.name)); })
      .catch(() => {});
  }, [activeWorkspaceId]);

  const completer = useCallback(
    (ctx: CompletionContext) => makeConceptCompleter(conceptNames)(ctx),
    [conceptNames]
  );

  const extensions = useMemo(() => [
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    wikiLinkPlugin,
    autocompletion({ override: [completer] }),
    EditorView.lineWrapping,
  ], [completer]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      autoFocus={autofocus}
      placeholder={placeholder}
      extensions={extensions}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        dropCursor: true,
        allowMultipleSelections: false,
        indentOnInput: true,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: true,
        highlightActiveLine: false,
        highlightSelectionMatches: true,
        searchKeymap: true,
      }}
      style={{ minHeight, fontSize: "0.875rem" }}
      theme="dark"
    />
  );
}
