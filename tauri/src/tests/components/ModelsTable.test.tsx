import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ModelsTable, type ModelFamilyGroup } from "@/components/ModelsTable";
import { getBackgroundIneligibility } from "@/lib/modelsTableFormat";
import type { AiModel, ModelSpeedStat } from "@/lib/api";

vi.mock("@/components/Tooltip", () => ({
  // Render tooltip content inline so assertions can reach it without hover.
  Tooltip: ({ content, children }: { content: React.ReactNode; children: React.ReactElement }) => (
    <span data-testid="tooltip" data-content={typeof content === "string" ? content : ""}>
      {children}
    </span>
  ),
}));

function makeModel(overrides: Partial<AiModel> = {}): AiModel {
  return {
    id: "m-1",
    name: "gemma4:e4b",
    model_id: "gemma4:e4b",
    provider: "ollama",
    role_tags: [],
    priority: 1,
    is_paid: false,
    enabled: true,
    is_hidden: false,
    tokens_used_total: 0,
    created_at: "2026-01-01T00:00:00Z",
    context_size: null,
    ...overrides,
  };
}

function makeGroups(models: AiModel[]): ModelFamilyGroup[] {
  return [{ key: "gemma4", label: "Gemma4", models }];
}

function renderTable(models: AiModel[], props: Partial<React.ComponentProps<typeof ModelsTable>> = {}) {
  const onSelectBackgroundModel = vi.fn();
  const onToggleEnabled = vi.fn();
  const onToggleHidden = vi.fn();

  render(
    <ModelsTable
      groups={makeGroups(models)}
      aiModels={models}
      ollamaModels={[]}
      modelSpeedStats={{}}
      modelLabels={{}}
      backgroundModelId={undefined}
      recommendedMaxParamsB={14}
      composerMode="single"
      showFamilyHeadings={false}
      editingModelId={null}
      editingName=""
      onEditingNameChange={vi.fn()}
      onStartRename={vi.fn()}
      onCommitRename={vi.fn()}
      onCancelRename={vi.fn()}
      draggedModelId={null}
      dragOverModelId={null}
      draggedFamilyId={null}
      dragOverFamilyId={null}
      onModelDragStart={vi.fn()}
      onFamilyDragStart={vi.fn()}
      onSelectBackgroundModel={onSelectBackgroundModel}
      onToggleEnabled={onToggleEnabled}
      onToggleHidden={onToggleHidden}
      onSaveContextSize={vi.fn().mockResolvedValue(undefined)}
      onClearContextSize={vi.fn().mockResolvedValue(undefined)}
      {...props}
    />
  );

  return { onSelectBackgroundModel, onToggleEnabled, onToggleHidden };
}

describe("getBackgroundIneligibility", () => {
  it("allows an active, large-enough local model", () => {
    expect(getBackgroundIneligibility({ provider: "ollama", enabled: true }, 8)).toBeNull();
  });

  it("rejects an inactive model", () => {
    expect(getBackgroundIneligibility({ provider: "ollama", enabled: false }, 8)).toBe("disabled");
  });

  it("rejects a model below the structured-output floor", () => {
    expect(getBackgroundIneligibility({ provider: "ollama", enabled: true }, 1.5)).toBe("too-small");
  });

  it("rejects a remote provider", () => {
    expect(getBackgroundIneligibility({ provider: "web_claude", enabled: true }, 100)).toBe("not-local");
  });

  it("treats unknown parameter counts as eligible rather than blocking them", () => {
    expect(getBackgroundIneligibility({ provider: "ollama", enabled: true }, null)).toBeNull();
  });
});

describe("ModelsTable — background default control", () => {
  it("offers an actionable control for an eligible model and reports the selection", () => {
    const model = makeModel({ model_id: "gemma4:e4b", name: "gemma4:e4b" });
    const { onSelectBackgroundModel } = renderTable([model]);

    const setDefault = screen.getByRole("button", {
      name: /use gemma4:e4b as the background default model/i,
    });
    fireEvent.click(setDefault);

    expect(onSelectBackgroundModel).toHaveBeenCalledWith("gemma4:e4b");
  });

  it("marks the current background default and stops offering to set it again", () => {
    const model = makeModel({ id: "m-bg", model_id: "gemma4:e4b" });
    renderTable([model], { backgroundModelId: "gemma4:e4b" });

    // Scope to the row: "Background" also names the column header.
    const row = document.querySelector('[data-model-id="m-bg"]') as HTMLElement;
    expect(within(row).getByText("Background")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /as the background default model/i })
    ).toBeNull();
  });

  it("states the reason inline when a model is too small, instead of only on hover", () => {
    // Regression: ineligible rows used to render an identical empty radio, so
    // the constraint was invisible until the user hovered.
    const tiny = makeModel({ id: "m-tiny", model_id: "qwen2.5-coder:1.5b", name: "qwen2.5-coder:1.5b" });
    renderTable([tiny]);

    expect(screen.getByText(/needs 4b\+/i)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /as the background default model/i })
    ).toBeNull();
  });

  it("states the reason inline when a model is inactive", () => {
    const off = makeModel({ enabled: false, model_id: "gemma4:e4b" });
    renderTable([off]);

    expect(screen.getByText(/turn on active first/i)).toBeTruthy();
  });

  it("distinguishes the two ineligibility causes rather than collapsing them", () => {
    const off = makeModel({ id: "m-off", model_id: "gemma4:e4b", name: "gemma4:e4b", enabled: false });
    const tiny = makeModel({ id: "m-tiny", model_id: "qwen3:1.5b", name: "qwen3:1.5b", enabled: true });
    renderTable([off, tiny]);

    expect(screen.getByText(/turn on active first/i)).toBeTruthy();
    expect(screen.getByText(/needs 4b\+/i)).toBeTruthy();
  });

  it("shows no background control for remote providers", () => {
    const web = makeModel({ id: "m-web", provider: "web_claude", model_id: "claude", name: "Claude" });
    renderTable([web]);

    expect(screen.queryByText(/local models only/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /as the background default model/i })
    ).toBeNull();
  });
});

describe("ModelsTable — column info affordances", () => {
  it("exposes each column hint as a focusable labelled button", () => {
    // Regression: hints were an 8px `ⓘ` glyph at 60% opacity — not reachable
    // by keyboard and effectively invisible.
    renderTable([makeModel()]);

    for (const label of ["Background", "Context", "Active", "In picker"]) {
      expect(screen.getByRole("button", { name: `About ${label}` })).toBeTruthy();
    }
  });
});

describe("ModelsTable — row state", () => {
  it("labels an inactive model on the row itself", () => {
    renderTable([makeModel({ enabled: false })]);
    expect(screen.getByText("Off")).toBeTruthy();
  });

  it("distinguishes an unused model from a measured zero", () => {
    renderTable([makeModel({ tokens_used_total: 0 })]);

    expect(screen.getByText("unused")).toBeTruthy();
    expect(screen.getByText(/speed not measured yet/i)).toBeTruthy();
  });

  it("reports measured throughput when stats exist", () => {
    const model = makeModel({ model_id: "gemma4:e4b", tokens_used_total: 12468 });
    const stats: Record<string, ModelSpeedStat> = {
      "gemma4:e4b": {
        model_name: "gemma4:e4b",
        avg_chat_tokens_per_second: 30.2,
        weighted_tokens_per_second: 30.4,
        chat_count: 7,
      },
    };
    renderTable([model], { modelSpeedStats: stats });

    expect(screen.getByText("30.2 tok/s")).toBeTruthy();
    expect(screen.getByText("(30.4 tok/s weighted)")).toBeTruthy();
    expect(screen.getByText("12,468 tok")).toBeTruthy();
    expect(screen.queryByText(/speed not measured yet/i)).toBeNull();
  });

  it("gives the visibility toggle a state-describing accessible name", () => {
    const model = makeModel({ name: "gemma4:e4b", is_hidden: false });
    const { onToggleHidden } = renderTable([model]);

    const hideButton = screen.getByRole("button", { name: /hide gemma4:e4b from chat picker/i });
    expect(hideButton.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(hideButton);
    expect(onToggleHidden).toHaveBeenCalled();
  });

  it("marks the background-default row for styling without adding a column", () => {
    const model = makeModel({ id: "m-bg", model_id: "gemma4:e4b" });
    renderTable([model], { backgroundModelId: "gemma4:e4b" });

    const row = document.querySelector('[data-model-id="m-bg"]') as HTMLElement;
    expect(row.getAttribute("data-background-default")).toBe("true");
  });

  it("renders a context override without shifting the row into a taller layout", () => {
    renderTable([makeModel({ context_size: 1024, name: "gemma4:e2b" })]);

    const input = screen.getByRole("spinbutton", {
      name: /context window for gemma4:e2b/i,
    }) as HTMLInputElement;
    expect(input.value).toBe("1024");
    // The old layout appended a "default: 8192" line only on overridden rows,
    // making them taller than their neighbours. The reset button carries that
    // affordance now.
    expect(screen.queryByText(/default: 8192/i)).toBeNull();
    expect(screen.getByRole("button", { name: /reset context window for gemma4:e2b/i })).toBeTruthy();
  });

  it("keeps the placeholder as the default hint when no override is set", () => {
    renderTable([makeModel({ context_size: null, name: "gemma4:e4b" })]);

    const input = screen.getByRole("spinbutton", {
      name: /context window for gemma4:e4b/i,
    }) as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("8192");
    expect(screen.queryByRole("button", { name: /reset context window/i })).toBeNull();
  });
});

describe("ModelsTable — family headings", () => {
  it("renders a family heading only when there are multiple families", () => {
    const model = makeModel();
    const { rerender } = render(
      <ModelsTable
        groups={makeGroups([model])}
        aiModels={[model]}
        ollamaModels={[]}
        modelSpeedStats={{}}
        modelLabels={{}}
        backgroundModelId={undefined}
        recommendedMaxParamsB={14}
        composerMode="single"
        showFamilyHeadings={false}
        editingModelId={null}
        editingName=""
        onEditingNameChange={vi.fn()}
        onStartRename={vi.fn()}
        onCommitRename={vi.fn()}
        onCancelRename={vi.fn()}
        draggedModelId={null}
        dragOverModelId={null}
        draggedFamilyId={null}
        dragOverFamilyId={null}
        onModelDragStart={vi.fn()}
        onFamilyDragStart={vi.fn()}
        onSelectBackgroundModel={vi.fn()}
        onToggleEnabled={vi.fn()}
        onToggleHidden={vi.fn()}
        onSaveContextSize={vi.fn().mockResolvedValue(undefined)}
        onClearContextSize={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.queryByText("Gemma4")).toBeNull();

    rerender(
      <ModelsTable
        groups={makeGroups([model])}
        aiModels={[model]}
        ollamaModels={[]}
        modelSpeedStats={{}}
        modelLabels={{}}
        backgroundModelId={undefined}
        recommendedMaxParamsB={14}
        composerMode="single"
        showFamilyHeadings
        editingModelId={null}
        editingName=""
        onEditingNameChange={vi.fn()}
        onStartRename={vi.fn()}
        onCommitRename={vi.fn()}
        onCancelRename={vi.fn()}
        draggedModelId={null}
        dragOverModelId={null}
        draggedFamilyId={null}
        dragOverFamilyId={null}
        onModelDragStart={vi.fn()}
        onFamilyDragStart={vi.fn()}
        onSelectBackgroundModel={vi.fn()}
        onToggleEnabled={vi.fn()}
        onToggleHidden={vi.fn()}
        onSaveContextSize={vi.fn().mockResolvedValue(undefined)}
        onClearContextSize={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByText("Gemma4")).toBeTruthy();
  });

  it("scopes a rename affordance to each row", () => {
    const a = makeModel({ id: "m-a", model_id: "gemma4:e2b", name: "gemma4:e2b" });
    const b = makeModel({ id: "m-b", model_id: "gemma4:e4b", name: "gemma4:e4b" });
    renderTable([a, b]);

    const rowA = document.querySelector('[data-model-id="m-a"]') as HTMLElement;
    expect(within(rowA).getByRole("button", { name: /rename gemma4:e2b/i })).toBeTruthy();
  });
});
