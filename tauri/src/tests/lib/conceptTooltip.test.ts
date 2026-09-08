import { describe, expect, it } from "vitest";
import { buildConceptTooltip, suggestedRankFromEase } from "@/lib/conceptTooltip";
import { conceptRankLabel, CONCEPT_RANK_LEVELS } from "@/lib/api";

const base = {
  name: "rsync",
  concept_type: "technology",
  self_rank: null as number | null,
};

describe("conceptRankLabel", () => {
  it("names each configured level and rejects out-of-range ranks", () => {
    expect(conceptRankLabel(1)).toBe(CONCEPT_RANK_LEVELS[0]);
    expect(conceptRankLabel(CONCEPT_RANK_LEVELS.length)).toBe(
      CONCEPT_RANK_LEVELS[CONCEPT_RANK_LEVELS.length - 1],
    );
    expect(conceptRankLabel(null)).toBeNull();
    expect(conceptRankLabel(CONCEPT_RANK_LEVELS.length + 1)).toBeNull();
  });
});

describe("suggestedRankFromEase", () => {
  it("gives no suggestion until something has actually been reviewed", () => {
    // An unreviewed concept must not be labelled — a default would read as a
    // judgement the review data does not support.
    expect(suggestedRankFromEase(2.5, 0)).toBeNull();
    expect(suggestedRankFromEase(null, 3)).toBeNull();
  });

  it("maps the ease range onto the configured levels", () => {
    // 1.3 is the SM-2 floor, 2.5 the nominal ceiling used elsewhere.
    expect(suggestedRankFromEase(1.3, 4)).toBe(1);
    expect(suggestedRankFromEase(2.5, 4)).toBe(CONCEPT_RANK_LEVELS.length);
  });

  it("clamps eases outside the nominal range", () => {
    expect(suggestedRankFromEase(0.5, 2)).toBe(1);
    expect(suggestedRankFromEase(9, 2)).toBe(CONCEPT_RANK_LEVELS.length);
  });
});

describe("buildConceptTooltip", () => {
  it("says the rank is unset rather than implying a level", () => {
    expect(buildConceptTooltip(base)).toContain("Rank: not set");
  });

  it("shows the user's rank with its position in the scale", () => {
    const text = buildConceptTooltip({ ...base, self_rank: 2 });
    expect(text).toContain(`Rank: ${CONCEPT_RANK_LEVELS[1]} (2/${CONCEPT_RANK_LEVELS.length})`);
  });

  it("surfaces a suggestion only when it differs from the user's own rank", () => {
    const agreeing = buildConceptTooltip({ ...base, self_rank: 3 }, { suggestedRank: 3 });
    expect(agreeing).not.toContain("Suggested");

    const differing = buildConceptTooltip({ ...base, self_rank: 1 }, { suggestedRank: 3 });
    expect(differing).toContain(`Suggested: ${CONCEPT_RANK_LEVELS[2]}`);
  });

  it("reports card and review counts, and distinguishes having no cards", () => {
    expect(buildConceptTooltip(base, { cardCount: 0 })).toContain("No cards yet");
    expect(buildConceptTooltip(base, { cardCount: 4, reviewCount: 2 })).toContain(
      "4 cards, 2 reviewed",
    );
    expect(buildConceptTooltip(base, { cardCount: 1, reviewCount: 0 })).toContain(
      "1 card, 0 reviewed",
    );
  });

  it("includes graph position and omits an absent link count", () => {
    const text = buildConceptTooltip(base, { hierarchyPath: "Linux › Tools", linkCount: 3 });
    expect(text).toContain("Linux › Tools");
    expect(text).toContain("3 links");
    expect(buildConceptTooltip(base, { linkCount: 0 })).not.toContain("link");
  });

  it("never shows an extraction date", () => {
    // The date was noise in a hover meant to answer "how well do I know this?".
    expect(buildConceptTooltip(base, { cardCount: 2 })).not.toContain("Extracted");
  });
});
