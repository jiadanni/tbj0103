import type { AppSettings, BackgroundJobRunMode } from "./api";

/**
 * Job catalog. `job_key` is the scheduler's task_type (used for run-mode /
 * heavy-model settings, status-bar events, cancel/confirm). `model_setting`
 * is the AppSettings key that holds the small (default) model — already wired
 * through Rust's `get_model_for_job`. `tokens`/`note` are sizing hints.
 */
export type JobCadenceField = {
  setting: keyof AppSettings;
  label: string;
  min: number;
  max: number;
  fallback: number;
  kind?: "number" | "toggle";
  gatedBy?: keyof AppSettings;
};

/**
 * Jobs flagged `structured` must parse strict JSON out of the model response.
 * Models under ~4B parameters routinely emit invalid JSON (single quotes,
 * broken keys), so every run fails at the parse step — warn before it happens.
 */
export const STRUCTURED_OUTPUT_MIN_PARAMS_B = 4;

export const INFERENCE_JOBS_CATALOG: {
  job_key: string;
  model_setting: keyof AppSettings;
  label: string;
  description: string;
  tokens: string;
  note: string;
  manual?: boolean;
  structured?: boolean;
  cadence?: JobCadenceField[];
}[] = [
  {
    job_key: "memory_extraction",
    model_setting: "memory_extraction_model",
    label: "Memory Extraction",
    description: "Extract durable facts from finished chats",
    tokens: "~200–1,000 tokens input",
    note: "2k context OK",
    structured: true,
    cadence: [
      { setting: "memory_extraction_threshold", label: "After N messages", min: 2, max: 50, fallback: 5 },
      { setting: "memory_extraction_idle_minutes", label: "Idle minutes before run", min: 1, max: 60, fallback: 5 },
    ],
  },
  {
    job_key: "summarization",
    model_setting: "summarization_model",
    label: "Summarization",
    description: "Roll up long chat sessions",
    tokens: "~500–5,000 tokens input",
    note: "≥4k context recommended",
    cadence: [
      { setting: "summarization_min_messages", label: "Min messages before summarizing", min: 1, max: 100, fallback: 1 },
      { setting: "summarization_max_sessions", label: "Max sessions per tick", min: 1, max: 20, fallback: 5 },
    ],
  },
  { job_key: "flashcard_generation", model_setting: "flashcard_model", label: "Flashcard Generation", description: "Generate spaced-repetition cards from topics", tokens: "~100–200 tokens input", note: "2k context OK", structured: true },
  { job_key: "flashcard_cleanup", model_setting: "flashcard_cleanup_model", label: "Flashcard Cleanup", description: "Merge duplicate cards per topic, keeping the most-reviewed / largest-model card", tokens: "~200–1,000 tokens input", note: "2k context OK", structured: true },
  { job_key: "memory_cleanup", model_setting: "memory_cleanup_model", label: "Memory Cleanup", description: "Prune junk memories and merge paraphrased duplicates per workspace", tokens: "~200–1,500 tokens input", note: "2k context OK", structured: true },
  {
    job_key: "workspace_glossary",
    model_setting: "glossary_model",
    label: "Workspace Glossary",
    description: "Refresh per-workspace term definitions",
    tokens: "~800–2,000 tokens input",
    note: "≥4k context recommended",
    structured: true,
    cadence: [
      { setting: "workspace_glossary_refresh_interval_minutes", label: "Refresh every (minutes)", min: 5, max: 240, fallback: 60 },
    ],
  },
  {
    job_key: "hover_definition_scan",
    model_setting: "glossary_model",
    label: "Hover Definitions",
    description: "Find undefined terms in recent chats",
    tokens: "~400–1,500 tokens input",
    note: "2k context OK",
    structured: true,
    cadence: [
      { setting: "hover_definition_scan_enabled", label: "Scan replies for unresolved terminology", min: 0, max: 1, fallback: 1, kind: "toggle" },
      { setting: "hover_definition_scan_max_sessions", label: "Max sessions scanned per tick", min: 1, max: 20, fallback: 3, gatedBy: "hover_definition_scan_enabled" },
    ],
  },
  {
    job_key: "workspace_prompt_bank",
    model_setting: "topic_signature_model",
    label: "Starter Prompts / Topic Signatures",
    description: "Refresh per-workspace prompt suggestions",
    tokens: "~1,000–3,000 tokens input",
    note: "≥4k context recommended",
    structured: true,
    cadence: [
      { setting: "topic_analysis_interval_minutes", label: "Refresh every (minutes)", min: 5, max: 120, fallback: 30 },
    ],
  },
  { job_key: "concept_hierarchy", model_setting: "concept_hierarchy_model", label: "Topic Hierarchy", description: "LLM-assisted concept parent linking", tokens: "~200–800 tokens input", note: "2k context OK" },
  { job_key: "workspace_analysis", model_setting: "workspace_analysis_model", label: "Workspace Analysis", description: "Global default for manual roadmap extraction", tokens: "~1,000–10,000 tokens input", note: "larger context recommended", manual: true },
];

export const RUN_MODE_OPTIONS: { value: BackgroundJobRunMode; label: string; description: string }[] = [
  { value: "auto", label: "Auto", description: "Run on schedule with the small model" },
  { value: "confirm_only", label: "Ask first", description: "Only run when the play-button is clicked; skip on timeout" },
  { value: "dual_model", label: "Ask for heavy, fallback small", description: "Run small on timeout; heavy on confirm" },
  { value: "disabled", label: "Disabled", description: "Do not run this job automatically" },
];
