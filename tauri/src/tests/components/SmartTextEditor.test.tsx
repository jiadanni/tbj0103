import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SmartTextEditor from "../../components/SmartTextEditor";
import { api } from "../../lib/api";

let activeWorkspaceId = "ws-1";
const mockCodeMirror = vi.fn((props: { extensions?: unknown[] }) => (
  <div data-testid="smart-text-editor" data-extension-count={props.extensions?.length ?? 0} />
));
const mockAutocompletion = vi.fn((config: { override: Array<(context: { matchBefore: (pattern: RegExp) => { from: number; text: string } | null; }) => unknown> }) => ({
  kind: "autocompletion",
  config,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

vi.mock("@uiw/react-codemirror", () => ({
  default: (props: { extensions?: unknown[] }) => mockCodeMirror(props),
}));

vi.mock("@codemirror/autocomplete", () => ({
  autocompletion: (config: { override: Array<(context: { matchBefore: (pattern: RegExp) => { from: number; text: string } | null; }) => unknown> }) => mockAutocompletion(config),
  CompletionContext: class {},
  CompletionResult: class {},
}));

vi.mock("@codemirror/view", () => ({
  Decoration: { mark: vi.fn(() => ({ kind: "decoration-mark" })) },
  DecorationSet: class {},
  EditorView: {
    theme: vi.fn((theme: unknown, options: unknown) => ({ kind: "editor-theme", theme, options })),
    lineWrapping: { kind: "line-wrapping" },
  },
  ViewPlugin: { fromClass: vi.fn(() => ({ kind: "view-plugin" })) },
  ViewUpdate: class {},
}));

vi.mock("@codemirror/state", () => ({
  RangeSetBuilder: class {
    add() {}
    finish() { return []; }
  },
}));

vi.mock("@codemirror/lang-markdown", () => ({
  markdown: vi.fn(() => ({ kind: "markdown-extension" })),
  markdownLanguage: { kind: "markdown-language" },
}));

vi.mock("@codemirror/language-data", () => ({
  languages: [],
}));

vi.mock("../../lib/workspacePane", () => ({
  useScopedWorkspace: () => ({ activeWorkspaceId }),
}));

vi.mock("../../lib/api", () => ({
  api: {
    graph: {
      listConcepts: vi.fn(),
    },
  },
}));

describe("SmartTextEditor", () => {
  beforeEach(() => {
    activeWorkspaceId = "ws-1";
    mockCodeMirror.mockClear();
    mockAutocompletion.mockClear();
    vi.clearAllMocks();
  });

  it("ignores stale concept results after the workspace changes", async () => {
    const ws1 = deferred<Array<{ name: string }>>();
    const ws2 = deferred<Array<{ name: string }>>();
    const listConceptsMock = vi.mocked(api.graph.listConcepts);
    listConceptsMock.mockImplementation((workspaceId: string) => {
      if (workspaceId === "ws-1") {
        return ws1.promise as Promise<never>;
      }
      return ws2.promise as Promise<never>;
    });

    const { rerender } = render(
      <SmartTextEditor value="" onChange={vi.fn()} />
    );

    expect(listConceptsMock).toHaveBeenCalledWith("ws-1");
    expect(mockAutocompletion).toHaveBeenCalledTimes(1);

    activeWorkspaceId = "ws-2";
    rerender(<SmartTextEditor value="" onChange={vi.fn()} />);

    expect(listConceptsMock).toHaveBeenCalledWith("ws-2");
    expect(mockAutocompletion).toHaveBeenCalledTimes(1);

    await act(async () => {
      ws2.resolve([{ name: "Beta" }]);
      await ws2.promise;
    });

    await waitFor(() => {
      expect(mockAutocompletion).toHaveBeenCalledTimes(2);
    });

    const latestConfigAfterWs2 = mockAutocompletion.mock.calls[mockAutocompletion.mock.calls.length - 1]?.[0];
    const ws2Completer = latestConfigAfterWs2?.override[0];
    const ws2Result = ws2Completer?.({
      matchBefore: () => ({ from: 0, text: "[[be" }),
    });

    expect(ws2Result).toMatchObject({
      options: [{ label: "Beta", apply: "[[Beta]]" }],
    });

    await act(async () => {
      ws1.resolve([{ name: "Alpha" }]);
      await ws1.promise;
    });

    expect(mockAutocompletion).toHaveBeenCalledTimes(2);

    const latestConfig = mockAutocompletion.mock.calls[mockAutocompletion.mock.calls.length - 1]?.[0];
    const completer = latestConfig?.override[0];
    const result = completer?.({
      matchBefore: () => ({ from: 0, text: "[[be" }),
    });

    expect(result).toMatchObject({
      options: [{ label: "Beta", apply: "[[Beta]]" }],
    });
  });
});
