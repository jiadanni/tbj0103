/**
 * conceptTooltip — the hover summary shown for a knowledge-map concept, shared
 * by the roadmap graph nodes and the topics sidebar rows so both describe a
 * concept the same way.
 *
 * Hover is read-only by nature: this reports the user's self-rank and the
 * signals behind it, while setting the rank lives in the concept detail panel.
 */
import { conceptRankLabel, CONCEPT_RANK_LEVELS, type ConceptNode } from "./api";

export interface ConceptTooltipStats {
  /** Cards attached to this concept, if known. */
  cardCount?: number;
  /** Cards with at least one review, if known. */
  reviewCount?: number;
  /** Chapter / section path this concept sits under, if known. */
  hierarchyPath?: string;
  /** Concepts linked to this one, if known. */
  linkCount?: number;
  /** Rank suggested by review performance, 1-based. */
  suggestedRank?: number | null;
}

/**
 * Suggest a rank from SM-2 review performance. Mirrors the mastery mapping
 * used elsewhere (ease factor 1.3 floor, 2.5 nominal) and scales it across the
 * configured level names. Returns null when there is nothing to go on — an
 * unreviewed concept gets no suggestion rather than a misleading "New".
 */
export function suggestedRankFromEase(
  avgEase: number | null | undefined,
  reviewedCards: number,
): number | null {
  if (avgEase == null || reviewedCards <= 0) { return null; }
  const mastery = Math.min(Math.max((avgEase - 1.3) / (2.5 - 1.3), 0), 1);
  // Map [0,1] onto 1..levels, so a fully-mastered concept lands on the top level.
  const levels = CONCEPT_RANK_LEVELS.length;
  return Math.min(levels, Math.max(1, Math.round(mastery * (levels - 1)) + 1));
}

/**
 * Build the hover text for a concept. Lines are joined with " • " so the string
 * stays usable as an SVG <title> and an HTML title attribute alike, neither of
 * which renders markup.
 */
export function buildConceptTooltip(
  node: Pick<ConceptNode, "name" | "concept_type" | "self_rank">,
  stats: ConceptTooltipStats = {},
): string {
  const parts: string[] = [`${node.name} (${node.concept_type})`];

  const rank = conceptRankLabel(node.self_rank);
  const total = CONCEPT_RANK_LEVELS.length;
  if (rank) {
    parts.push(`Rank: ${rank} (${node.self_rank}/${total})`);
  } else {
    parts.push("Rank: not set");
  }

  const suggested = conceptRankLabel(stats.suggestedRank);
  // Only worth showing when it disagrees with the user's own rank — otherwise
  // it is noise confirming what the line above already said.
  if (suggested && stats.suggestedRank !== node.self_rank) {
    parts.push(`Suggested: ${suggested}`);
  }

  if (stats.cardCount != null) {
    const reviewed = stats.reviewCount ?? 0;
    parts.push(
      stats.cardCount === 0
        ? "No cards yet"
        : `${stats.cardCount} card${stats.cardCount === 1 ? "" : "s"}, ${reviewed} reviewed`,
    );
  }

  if (stats.hierarchyPath) {
    parts.push(stats.hierarchyPath);
  }
  if (stats.linkCount != null && stats.linkCount > 0) {
    parts.push(`${stats.linkCount} link${stats.linkCount === 1 ? "" : "s"}`);
  }

  return parts.join(" • ");
}

/**
 * The same content as [`buildConceptTooltip`], but as discrete rows for the
 * styled hover card. The plain-string form stays for `<title>` fallbacks and
 * for tests that assert on hover text.
 */
export function buildConceptTooltipRows(
  node: Pick<ConceptNode, "name" | "concept_type" | "self_rank">,
  stats: ConceptTooltipStats = {},
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const total = CONCEPT_RANK_LEVELS.length;
  const rank = conceptRankLabel(node.self_rank);
  rows.push({ label: "Rank", value: rank ? `${rank} (${node.self_rank}/${total})` : "Not set" });

  const suggested = conceptRankLabel(stats.suggestedRank);
  if (suggested && stats.suggestedRank !== node.self_rank) {
    rows.push({ label: "Suggested", value: suggested });
  }
  if (stats.cardCount != null) {
    rows.push({
      label: "Cards",
      value: stats.cardCount === 0
        ? "None yet"
        : `${stats.cardCount} (${stats.reviewCount ?? 0} reviewed)`,
    });
  }
  if (stats.hierarchyPath) {
    rows.push({ label: "In", value: stats.hierarchyPath });
  }
  if (stats.linkCount != null && stats.linkCount > 0) {
    rows.push({ label: "Links", value: String(stats.linkCount) });
  }
  return rows;
}
