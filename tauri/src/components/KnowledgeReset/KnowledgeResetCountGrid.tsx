import type { KnowledgeResetResult } from "../../lib/api";

/** Summary grid of affected row counts shown in the reset dialog + previews. */
export function KnowledgeResetCountGrid({ result }: { result: KnowledgeResetResult }) {
  const items: Array<[string, number]> = [
    ["Workspaces", result.workspace_count],
    ["Concepts", result.concept_nodes],
    ["Links", result.concept_links],
    ["Mentions", result.concept_mentions],
    ["Snapshots", result.roadmap_snapshots],
    ["Analysis jobs", result.analyze_jobs + result.analyze_job_chunks],
    ["Proposals", result.change_proposals],
    ["Legacy topics", result.flashcard_topics],
    ["Cards deleted", result.generated_cards_deleted],
    ["Cards detached", result.generated_cards_detached],
    ["Goals detached", result.learning_goals_detached],
    ["Topic signatures", result.topic_signatures_cleared],
    ["Prompt bank", result.prompt_bank_prompts + result.prompt_bank_jobs],
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
          <div className="text-sm font-semibold text-[var(--text-primary)]">{value}</div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
        </div>
      ))}
    </div>
  );
}
