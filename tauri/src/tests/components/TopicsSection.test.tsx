import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { TopicsSection } from "@/components/TopicsSection";
import type { TopicSignature } from "@/lib/api";

const apiMocks = vi.hoisted(() => ({
  update: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      topicSignature: {
        ...actual.api.topicSignature,
        update: apiMocks.update,
      },
    },
  };
});

function buildSignature(overrides: Partial<TopicSignature> = {}): TopicSignature {
  return {
    auto_detected_tags: [
      { tag: "rust", weight: 0.9, source: "ollama" },
      { tag: "sqlite", weight: 0.4, source: "ollama" },
    ],
    custom_tags: ["agentic"],
    excluded_tags: [],
    intent_patterns: [],
    generated_at: null,
    message_count_at_gen: null,
    ollama_enriched: false,
    ...overrides,
  };
}

describe("TopicsSection", () => {
  it("excludes an auto-detected topic without changing custom topics", async () => {
    const updated = buildSignature({
      auto_detected_tags: [{ tag: "sqlite", weight: 0.4, source: "ollama" }],
      excluded_tags: ["rust"],
    });
    const onUpdate = vi.fn();
    apiMocks.update.mockResolvedValue(updated);

    render(
      <TopicsSection
        workspaceId="ws-1"
        topicSignature={buildSignature()}
        onUpdate={onUpdate}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Remove rust" })[0]);

    await waitFor(() => {
      expect(apiMocks.update).toHaveBeenCalledWith("ws-1", ["agentic"], ["rust"]);
    });
    expect(onUpdate).toHaveBeenCalledWith(updated);
  });

  it("removes a custom topic instead of moving it into the excluded list", async () => {
    const updated = buildSignature({
      custom_tags: [],
      excluded_tags: [],
    });
    const onUpdate = vi.fn();
    apiMocks.update.mockResolvedValue(updated);

    render(
      <TopicsSection
        workspaceId="ws-1"
        topicSignature={buildSignature()}
        onUpdate={onUpdate}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Remove agentic" })[0]);

    await waitFor(() => {
      expect(apiMocks.update).toHaveBeenCalledWith("ws-1", [], []);
    });
    expect(onUpdate).toHaveBeenCalledWith(updated);
  });
});
