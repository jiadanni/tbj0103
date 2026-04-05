/**
 * ThoughtQueueView — a dumping ground for quick thoughts that can be
 * scheduled for passive AI processing at a later time.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import {
  Plus, Trash2, Clock, CheckCircle2, Loader2,
  ChevronDown, ChevronRight, Calendar, Inbox, Zap, RefreshCw,
} from "lucide-react";
import { api, type ThoughtItem } from "../lib/api";
import { useSettingsStore } from "../stores/settingsStore";
import { useScopedWorkspace } from "../lib/workspacePane";

// ---- helpers ----------------------------------------------------------------

function statusBadge(status: ThoughtItem["status"]) {
  switch (status) {
    case "pending":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-primary)] text-[var(--text-muted)] border border-[var(--border-color)]">
          <Inbox size={10} /> pending
        </span>
      );
    case "scheduled":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
          <Clock size={10} /> scheduled
        </span>
      );
    case "processing":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
          <Loader2 size={10} className="animate-spin" /> processing
        </span>
      );
    case "done":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
          <CheckCircle2 size={10} /> done
        </span>
      );
  }
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// Local datetime-local input value → ISO string
function localInputToISO(value: string): string {
  return new Date(value).toISOString();
}

// ISO string → datetime-local input value
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---- component --------------------------------------------------------------

export default function ThoughtQueueView() {
  const { activeWorkspaceId } = useScopedWorkspace();
  const { preferredModel, ollamaUrl, modelLabels } = useSettingsStore();

  const [thoughts, setThoughts] = useState<ThoughtItem[]>([]);
  const [loading, setLoading] = useState(false);

  // New-thought form
  const [draftContent, setDraftContent] = useState("");
  const [draftPromptPrefix, setDraftPromptPrefix] = useState("");
  const [draftModel, setDraftModel] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [draftSchedule, setDraftSchedule] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    return isoToLocalInput(d.toISOString());
  });
  const [submitting, setSubmitting] = useState(false);

  // Expanded result panes
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Active processing set (IDs being processed via Ollama)
  const processingRef = useRef<Set<string>>(new Set());

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ---- load thoughts --------------------------------------------------------

  const loadThoughts = useCallback(async () => {
    if (!activeWorkspaceId) {return;}
    try {
      const items = await api.thoughtQueue.list(activeWorkspaceId);
      setThoughts(items);
    } catch {/* ignore */}
  }, [activeWorkspaceId]);

  useEffect(() => {
    setLoading(true);
    loadThoughts().finally(() => setLoading(false));
  }, [loadThoughts]);

  // ---- set default model ----------------------------------------------------

  useEffect(() => {
    setDraftModel(preferredModel || "");
  }, [preferredModel]);

  // ---- passive polling: check for due items every 60 s ----------------------

  const processDueThought = useCallback(async (thought: ThoughtItem) => {
    if (processingRef.current.has(thought.id)) {return;}
    processingRef.current.add(thought.id);
    try {
      await api.thoughtQueue.updateStatus(thought.id, "processing");
      setThoughts((prev) =>
        prev.map((t) => (t.id === thought.id ? { ...t, status: "processing" } : t))
      );

      const prefix = thought.prompt_prefix.trim();
      const userContent = prefix
        ? `${prefix}\n\n${thought.content}`
        : thought.content;

      const result = await api.ollama.sendMessage(
        thought.id,
        thought.model_name,
        [{ role: "user", content: userContent }],
        false,
        ollamaUrl,
      );

      await api.thoughtQueue.updateResult(thought.id, result);
      setThoughts((prev) =>
        prev.map((t) =>
          t.id === thought.id
            ? { ...t, status: "done", result, result_at: new Date().toISOString() }
            : t
        )
      );
      setExpandedId(thought.id);
    } catch {
      // Revert to scheduled so the next poll can retry
      await api.thoughtQueue.updateStatus(thought.id, "scheduled").catch(() => {});
      setThoughts((prev) =>
        prev.map((t) => (t.id === thought.id ? { ...t, status: "scheduled" } : t))
      );
    } finally {
      processingRef.current.delete(thought.id);
    }
  }, [ollamaUrl]);

  useEffect(() => {
    if (!activeWorkspaceId) {return;}

    async function pollDue() {
      if (!activeWorkspaceId) {return;}
      try {
        const due = await api.thoughtQueue.getDue(activeWorkspaceId);
        for (const t of due) {
          processDueThought(t);
        }
      } catch {/* ignore */}
    }

    pollDue(); // immediate on mount
    const timer = setInterval(pollDue, 60_000);
    return () => clearInterval(timer);
  }, [activeWorkspaceId, processDueThought]);

  // ---- actions --------------------------------------------------------------

  async function submitThought() {
    if (!activeWorkspaceId || !draftContent.trim()) {return;}
    setSubmitting(true);
    try {
      const processAt = scheduleEnabled ? localInputToISO(draftSchedule) : undefined;
      const thought = await api.thoughtQueue.create(activeWorkspaceId, draftContent.trim(), {
        processAt,
        modelName: draftModel || undefined,
        promptPrefix: draftPromptPrefix.trim() || undefined,
      });
      setThoughts((prev) => [thought, ...prev]);
      setDraftContent("");
      setDraftPromptPrefix("");
      setScheduleEnabled(false);
      textareaRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  async function processNow(thought: ThoughtItem) {
    if (thought.status === "processing") {return;}
    // Temporarily treat as "scheduled" so processDueThought picks it up
    const patched: ThoughtItem = { ...thought, status: "scheduled" };
    processDueThought(patched);
  }

  async function deleteThought(id: string) {
    await api.thoughtQueue.delete(id).catch(() => {});
    setThoughts((prev) => prev.filter((t) => t.id !== id));
    if (expandedId === id) {setExpandedId(null);}
  }

  // ---- render ---------------------------------------------------------------

  const pending = thoughts.filter((t) => t.status === "pending");
  const scheduled = thoughts.filter((t) => t.status === "scheduled");
  const processing = thoughts.filter((t) => t.status === "processing");
  const done = thoughts.filter((t) => t.status === "done");

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* ---- Main: queue list ----------------------------------------------- */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">
            <Loader2 size={18} className="animate-spin mr-2" /> Loading…
          </div>
        ) : thoughts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-muted)]">
            <Inbox size={40} className="opacity-30" />
            <p className="text-sm">Your thought queue is empty.</p>
            <p className="text-xs opacity-60">Add a thought from the right sidebar to get started.</p>
          </div>
        ) : (
          <div className="p-4 space-y-3 max-w-3xl mx-auto">
            {/* Ordered: processing → scheduled → pending → done */}
            {[...processing, ...scheduled, ...pending, ...done].map((thought) => (
              <ThoughtCard
                key={thought.id}
                thought={thought}
                modelLabels={modelLabels}
                expanded={expandedId === thought.id}
                onToggleExpand={() =>
                  setExpandedId((prev) => (prev === thought.id ? null : thought.id))
                }
                onProcessNow={() => processNow(thought)}
                onDelete={() => deleteThought(thought.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ---- Right: input sidebar ------------------------------------------- */}
      <aside className="w-80 shrink-0 border-l border-[var(--border-color)] flex min-h-0 flex-col bg-[var(--bg-sidebar)]">
        <div className="p-4 border-b border-[var(--border-color)]">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Inbox size={15} />
            Thought Queue
          </h2>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
            Dump ideas. Schedule AI to process them later.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="block text-[11px] text-[var(--text-muted)] mb-1">
              Thought / idea
            </label>
            <textarea
              ref={textareaRef}
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {submitThought();}
              }}
              placeholder="What's on your mind? Dump it here…"
              rows={5}
              className="w-full text-sm px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none resize-none focus:border-[var(--accent-color)]"
            />
          </div>

          <div>
            <label className="block text-[11px] text-[var(--text-muted)] mb-1">
              AI instruction <span className="opacity-60">(optional)</span>
            </label>
            <input
              type="text"
              value={draftPromptPrefix}
              onChange={(e) => setDraftPromptPrefix(e.target.value)}
              placeholder='e.g. "Summarise this idea"'
              className="w-full text-sm px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
            />
          </div>

          <div>
            <label className="block text-[11px] text-[var(--text-muted)] mb-1">Model</label>
            <input
              type="text"
              value={draftModel}
              onChange={(e) => setDraftModel(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
            />
          </div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={scheduleEnabled}
                onChange={(e) => setScheduleEnabled(e.target.checked)}
                className="rounded"
              />
              <span className="text-xs text-[var(--text-primary)]">Schedule for later</span>
              <Clock size={13} className="text-[var(--text-muted)]" />
            </label>
            {scheduleEnabled && (
              <input
                type="datetime-local"
                value={draftSchedule}
                onChange={(e) => setDraftSchedule(e.target.value)}
                className="mt-2 w-full text-sm px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
              />
            )}
          </div>

          <button
            onClick={submitThought}
            disabled={submitting || !draftContent.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-[var(--accent-color)] text-white text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {scheduleEnabled ? "Schedule thought" : "Add thought"}
          </button>

          <p className="text-[10px] text-[var(--text-muted)] text-center">
            ⌘+Enter to add quickly
          </p>
        </div>

        <div className="p-3 border-t border-[var(--border-color)] grid grid-cols-4 gap-1 text-center">
          {[
            { label: "pending", count: pending.length, color: "text-[var(--text-muted)]" },
            { label: "scheduled", count: scheduled.length, color: "text-blue-400" },
            { label: "running", count: processing.length, color: "text-yellow-400" },
            { label: "done", count: done.length, color: "text-green-400" },
          ].map(({ label, count, color }) => (
            <div key={label}>
              <div className={`text-lg font-semibold ${color}`}>{count}</div>
              <div className="text-[9px] text-[var(--text-muted)]">{label}</div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

// ---- ThoughtCard sub-component ----------------------------------------------

interface ThoughtCardProps {
  thought: ThoughtItem;
  modelLabels: Record<string, string>;
  expanded: boolean;
  onToggleExpand: () => void;
  onProcessNow: () => void;
  onDelete: () => void;
}

function ThoughtCard({ thought, modelLabels, expanded, onToggleExpand, onProcessNow, onDelete }: ThoughtCardProps) {
  const isActive = thought.status === "processing";
  const hasResult = !!thought.result;

  return (
    <div
      className={`rounded-lg border transition-colors ${
        isActive
          ? "border-yellow-500/30 bg-yellow-500/5"
          : thought.status === "done"
          ? "border-green-500/20 bg-[var(--bg-sidebar)]"
          : "border-[var(--border-color)] bg-[var(--bg-sidebar)]"
      }`}
    >
      {/* header row */}
      <div className="flex items-start gap-3 p-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            {statusBadge(thought.status)}
            {thought.process_at && thought.status !== "done" && (
              <span className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                <Calendar size={10} />
                {formatDate(thought.process_at)}
              </span>
            )}
            <span className="text-[10px] text-[var(--text-muted)] ml-auto">
              {formatDate(thought.created_at)}
            </span>
          </div>

          <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
            {thought.content}
          </p>

          {thought.prompt_prefix && (
            <p className="mt-1 text-[11px] text-[var(--text-muted)] italic">
              Instruction: {thought.prompt_prefix}
            </p>
          )}

          <div className="flex items-center gap-1.5 mt-2">
            <span className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-primary)] px-1.5 py-0.5 rounded">
              {modelLabels[thought.model_name] || thought.model_name}
            </span>
          </div>
        </div>

        {/* actions */}
        <div className="flex items-center gap-1 shrink-0">
          {(thought.status === "pending" || thought.status === "scheduled") && (
            <button
              onClick={onProcessNow}
              title="Process now"
              className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--accent-color)] hover:bg-[var(--bg-primary)] transition-colors"
            >
              <Zap size={14} />
            </button>
          )}
          {thought.status === "processing" && (
            <span className="p-1.5">
              <RefreshCw size={14} className="animate-spin text-yellow-400" />
            </span>
          )}
          {hasResult && (
            <button
              onClick={onToggleExpand}
              title={expanded ? "Collapse" : "Show result"}
              className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)] transition-colors"
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          )}
          <button
            onClick={onDelete}
            title="Delete"
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-red-400 hover:bg-[var(--bg-primary)] transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* result panel */}
      {expanded && thought.result && (
        <div className="border-t border-[var(--border-color)] px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={12} className="text-green-400" />
            <span className="text-[11px] text-[var(--text-muted)]">
              AI response{thought.result_at ? ` · ${formatDate(thought.result_at)}` : ""}
            </span>
          </div>
          <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
            {thought.result}
          </p>
        </div>
      )}
    </div>
  );
}
