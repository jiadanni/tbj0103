import { describe, expect, it } from "vitest";
import type { FeedCard } from "../../lib/api";
import {
  buildQueue,
  countsByLevel,
  filterCardsForMode,
  isCardEligible,
  reshuffleAvoidingRepeat,
} from "../../lib/feed/queue";
import {
  DEFAULT_PRESET_ID,
  formatDifficultyLabel,
  resolvePresetId,
} from "../../lib/feed/difficulty";

function card(overrides: Partial<FeedCard> & { id: string }): FeedCard {
  return {
    workspace_id: "ws-1",
    workspace_name: "Workspace One",
    front: "front",
    back: "back",
    source_type: "manual",
    ease_factor: 2.5,
    interval: 1,
    repetitions: 0,
    next_review_date: "2026-01-01",
    created_at: "2026-01-01T00:00:00Z",
    kind: "flashcard",
    ...overrides,
  } as FeedCard;
}

const allLevels = new Set([1, 2, 3, 4, 5] as const);

describe("isCardEligible", () => {
  it("excludes cards from workspaces that are not enabled", () => {
    const c = card({ id: "a", workspace_id: "ws-2" });
    expect(
      isCardEligible(c, {
        enabledWorkspaceIds: new Set(["ws-1"]),
        enabledDifficulties: allLevels,
      }),
    ).toBe(false);
  });

  it("excludes banished cards", () => {
    const c = card({ id: "a", suspended_at: "2026-01-02T00:00:00Z" });
    expect(
      isCardEligible(c, {
        enabledWorkspaceIds: new Set(["ws-1"]),
        enabledDifficulties: allLevels,
      }),
    ).toBe(false);
  });

  it("keeps unlevelled cards regardless of the level selection", () => {
    // Regression: a library that predates levelling has difficulty null on
    // every card. Treating that as "level not selected" emptied the feed.
    const nullLevel = card({ id: "a", difficulty: null });
    const undefinedLevel = card({ id: "b" });
    const filter = {
      enabledWorkspaceIds: new Set(["ws-1"]),
      enabledDifficulties: new Set([1] as const),
    };
    expect(isCardEligible(nullLevel, filter)).toBe(true);
    expect(isCardEligible(undefinedLevel, filter)).toBe(true);
  });

  it("excludes levelled cards whose level is deselected", () => {
    const c = card({ id: "a", difficulty: 4 });
    expect(
      isCardEligible(c, {
        enabledWorkspaceIds: new Set(["ws-1"]),
        enabledDifficulties: new Set([1, 2] as const),
      }),
    ).toBe(false);
  });
});

describe("filterCardsForMode", () => {
  it("splits info cards into Study and the rest into Test", () => {
    const cards = [
      card({ id: "info", kind: "info" }),
      card({ id: "flash", kind: "flashcard" }),
    ];
    expect(filterCardsForMode(cards, "study").map((c) => c.id)).toEqual(["info"]);
    expect(filterCardsForMode(cards, "test").map((c) => c.id)).toEqual(["flash"]);
  });

  it("falls back to every card rather than showing an empty feed", () => {
    // A deck with no `info` cards must still scroll in Study mode.
    const cards = [card({ id: "a" }), card({ id: "b" })];
    expect(filterCardsForMode(cards, "study").map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("reshuffleAvoidingRepeat", () => {
  it("never opens the new round with the card just shown", () => {
    const cards = ["a", "b", "c", "d"].map((id) => card({ id }));
    // Probabilistic guard: without the swap this fails within a few dozen runs.
    for (let i = 0; i < 200; i++) {
      expect(reshuffleAvoidingRepeat(cards, "a")[0].id).not.toBe("a");
    }
  });

  it("returns the single card unchanged when the deck has only one", () => {
    const cards = [card({ id: "solo" })];
    expect(reshuffleAvoidingRepeat(cards, "solo").map((c) => c.id)).toEqual(["solo"]);
  });
});

describe("buildQueue", () => {
  it("returns only eligible cards for the mode", () => {
    const cards = [
      card({ id: "keep", difficulty: 2 }),
      card({ id: "wrong-level", difficulty: 5 }),
      card({ id: "banished", difficulty: 2, suspended_at: "2026-01-02T00:00:00Z" }),
      card({ id: "other-ws", difficulty: 2, workspace_id: "ws-9" }),
    ];
    const queue = buildQueue(
      cards,
      {
        enabledWorkspaceIds: new Set(["ws-1"]),
        enabledDifficulties: new Set([1, 2] as const),
      },
      "test",
    );
    expect(queue.map((c) => c.id)).toEqual(["keep"]);
  });
});

describe("countsByLevel", () => {
  it("counts only enabled, non-banished, levelled cards", () => {
    const cards = [
      card({ id: "a", difficulty: 1 }),
      card({ id: "b", difficulty: 1 }),
      card({ id: "c", difficulty: 3 }),
      card({ id: "unlevelled" }),
      card({ id: "banished", difficulty: 1, suspended_at: "2026-01-02T00:00:00Z" }),
      card({ id: "other", difficulty: 1, workspace_id: "ws-9" }),
    ];
    const counts = countsByLevel(cards, new Set(["ws-1"]));
    expect(counts.get(1)).toBe(2);
    expect(counts.get(3)).toBe(1);
    expect(counts.get(5)).toBeUndefined();
  });
});

describe("difficulty presets", () => {
  it("prefers the card's own preset over the user's selection", () => {
    // The material's declared domain describes it better than a global pick.
    expect(
      resolvePresetId({ difficultyPreset: "medical_clinical" }, "aviation_aerospace"),
    ).toBe("medical_clinical");
  });

  it("falls back to the user's selection, then the default", () => {
    expect(resolvePresetId({}, "aviation_aerospace")).toBe("aviation_aerospace");
    expect(resolvePresetId({}, undefined)).toBe(DEFAULT_PRESET_ID);
  });

  it("ignores a preset id this build does not know", () => {
    expect(resolvePresetId({ difficultyPreset: "not_a_preset" }, undefined)).toBe(
      DEFAULT_PRESET_ID,
    );
  });

  it("labels a level from the resolved preset", () => {
    expect(formatDifficultyLabel(5, "medical_clinical").label).toBe(
      "Attending / Specialist",
    );
  });

  it("lets an explicit per-card label win over the preset's", () => {
    expect(formatDifficultyLabel(2, "medical_clinical", "Custom").label).toBe("Custom");
  });

  it("clamps an out-of-range score to the middle level", () => {
    expect(formatDifficultyLabel(undefined, "standard_5_star").score).toBe(3);
  });
});
