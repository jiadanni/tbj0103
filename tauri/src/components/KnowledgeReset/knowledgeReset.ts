/**
 * Shared helpers for the "Reset AI-Inferred Data" flow.
 *
 * These formatters, default options, and option-group copy are consumed by
 * both DataControlsPreferences (Preferences → Data Controls) and
 * WorkspaceSettingsView. Keep this the single source of truth so the two
 * surfaces cannot silently drift — historically the WorkspaceSettings twin
 * counted `roadmap_snapshots` while the Preferences twin did not.
 */
import type { KnowledgeResetOptions, KnowledgeResetResult } from "../../lib/api";

export const DEFAULT_KNOWLEDGE_RESET_OPTIONS: KnowledgeResetOptions = {
  clear_graph: true,
  clear_topic_signatures: true,
  clear_prompt_bank: true,
  clear_analysis_jobs: true,
  clear_legacy_topics: true,
  delete_generated_cards: true,
};

export const KNOWLEDGE_RESET_OPTION_GROUPS: Array<{
  title: string;
  rows: Array<{ key: keyof KnowledgeResetOptions; label: string; description: string }>;
}> = [
  {
    title: "Knowledge",
    rows: [
      { key: "clear_graph", label: "Graph and roadmap", description: "Concepts, links, mentions, graph statistics, and concept proposals." },
      { key: "clear_topic_signatures", label: "Topic signatures", description: "Workspace topic fingerprints that can re-seed old concepts." },
      { key: "clear_analysis_jobs", label: "Analysis jobs", description: "Analyze Workspace job and chunk history." },
    ],
  },
  {
    title: "Chat",
    rows: [
      { key: "clear_prompt_bank", label: "Prompt bank", description: "Stored starter prompts and prompt-bank jobs." },
    ],
  },
  {
    title: "Learning",
    rows: [
      { key: "clear_legacy_topics", label: "Legacy topics", description: "Flashcard topic rows from older topic systems." },
      { key: "delete_generated_cards", label: "Generated concept/topic cards", description: "If disabled, cards are kept but stale concept/topic links are detached." },
    ],
  },
];

export function totalKnowledgeResetRows(result: KnowledgeResetResult | null): number {
  if (!result) {
    return 0;
  }
  return result.concept_nodes
    + result.concept_links
    + result.concept_mentions
    + result.graph_statistics
    + result.roadmap_snapshots
    + result.analyze_jobs
    + result.analyze_job_chunks
    + result.change_proposals
    + result.flashcard_topics
    + result.generated_cards_deleted
    + result.generated_cards_detached
    + result.learning_goals_detached
    + result.topic_signatures_cleared
    + result.prompt_bank_prompts
    + result.prompt_bank_jobs;
}

export function formatKnowledgeResetResult(result: KnowledgeResetResult): string {
  const changed = totalKnowledgeResetRows(result);
  return `${changed} AI-inferred row${changed === 1 ? "" : "s"} reset across ${result.workspace_count} workspace${result.workspace_count === 1 ? "" : "s"}. Source material was preserved.`;
}

// The backend's `workspace` scope resolves exactly one workspace_id, so the
// "Selected workspaces" scope fans out to one call per workspace and the
// per-workspace results are summed back into a single result for display.
export function sumKnowledgeResetResults(results: KnowledgeResetResult[]): KnowledgeResetResult {
  return results.reduce<KnowledgeResetResult>((acc, next) => ({
    dry_run: next.dry_run,
    workspace_count: acc.workspace_count + next.workspace_count,
    concept_nodes: acc.concept_nodes + next.concept_nodes,
    concept_links: acc.concept_links + next.concept_links,
    concept_mentions: acc.concept_mentions + next.concept_mentions,
    graph_statistics: acc.graph_statistics + next.graph_statistics,
    roadmap_snapshots: acc.roadmap_snapshots + next.roadmap_snapshots,
    analyze_jobs: acc.analyze_jobs + next.analyze_jobs,
    analyze_job_chunks: acc.analyze_job_chunks + next.analyze_job_chunks,
    change_proposals: acc.change_proposals + next.change_proposals,
    flashcard_topics: acc.flashcard_topics + next.flashcard_topics,
    generated_cards_deleted: acc.generated_cards_deleted + next.generated_cards_deleted,
    generated_cards_detached: acc.generated_cards_detached + next.generated_cards_detached,
    learning_goals_detached: acc.learning_goals_detached + next.learning_goals_detached,
    topic_signatures_cleared: acc.topic_signatures_cleared + next.topic_signatures_cleared,
    prompt_bank_prompts: acc.prompt_bank_prompts + next.prompt_bank_prompts,
    prompt_bank_jobs: acc.prompt_bank_jobs + next.prompt_bank_jobs,
  }), {
    dry_run: results[0]?.dry_run ?? false,
    workspace_count: 0,
    concept_nodes: 0,
    concept_links: 0,
    concept_mentions: 0,
    graph_statistics: 0,
    roadmap_snapshots: 0,
    analyze_jobs: 0,
    analyze_job_chunks: 0,
    change_proposals: 0,
    flashcard_topics: 0,
    generated_cards_deleted: 0,
    generated_cards_detached: 0,
    learning_goals_detached: 0,
    topic_signatures_cleared: 0,
    prompt_bank_prompts: 0,
    prompt_bank_jobs: 0,
  });
}
