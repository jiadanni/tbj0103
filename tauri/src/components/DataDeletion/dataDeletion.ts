import type { DataDeletionCategoryCount, DataDeletionResult, DataDeletionTimeFilter } from "../../lib/api";

export interface CategoryOption {
  id: string;
  label: string;
  description: string;
}

export const DATA_DELETION_CATEGORIES: CategoryOption[] = [
  {
    id: "chats",
    label: "Chats & messages",
    description: "Chat sessions, folders, message history, citations, artifacts, and local chat files.",
  },
  {
    id: "notes",
    label: "Notes & templates",
    description: "Project notes, daily notes, and custom templates (built-in templates are preserved).",
  },
  {
    id: "sources",
    label: "Sources & documents",
    description: "Uploaded documents, web captures, source chunks, and transcriptions.",
  },
  {
    id: "flashcards",
    label: "Flashcards & goals",
    description: "Spaced-repetition flashcards, review history, learning goals, and quizzes.",
  },
  {
    id: "concepts",
    label: "Concepts & knowledge map",
    description: "Concept nodes, links, mentions, roadmap snapshots, proposals, and topic signatures.",
  },
  {
    id: "memories",
    label: "Memories",
    description: "Long-term AI memories, vector embeddings, and memory summaries.",
  },
  {
    id: "queue",
    label: "Thought queue & alarms",
    description: "Captured thoughts in the queue and scheduled calendar reminders.",
  },
];

export const TIME_FILTER_OPTIONS: Array<{ value: DataDeletionTimeFilter; label: string; description: string }> = [
  { value: "all", label: "All time", description: "Delete all records in the selected categories." },
  { value: "7d", label: "Older than 7 days", description: "Only delete records not modified in the last 7 days." },
  { value: "30d", label: "Older than 30 days", description: "Only delete records not modified in the last 30 days." },
  { value: "90d", label: "Older than 90 days", description: "Only delete records not modified in the last 90 days." },
  { value: "365d", label: "Older than 1 year", description: "Only delete records not modified in the last year." },
];

export function formatDataDeletionResult(result: DataDeletionResult): string {
  const summary = result.categories
    .filter((c) => c.item_count > 0)
    .map((c) => `${c.item_count} ${c.label.toLowerCase()}`)
    .join(", ");

  const wsPart = `across ${result.workspace_count} workspace${result.workspace_count === 1 ? "" : "s"}`;
  if (result.total_deleted_items === 0) {
    return `No matching data found to delete ${wsPart}.`;
  }
  return `Permanently deleted ${result.total_deleted_items} items (${summary || `${result.total_deleted_rows} records`}) ${wsPart}.`;
}

export function sumCategoryCounts(categories: DataDeletionCategoryCount[]): { totalItems: number; totalRows: number } {
  return categories.reduce(
    (acc, curr) => ({
      totalItems: acc.totalItems + curr.item_count,
      totalRows: acc.totalRows + curr.total_rows,
    }),
    { totalItems: 0, totalRows: 0 },
  );
}
