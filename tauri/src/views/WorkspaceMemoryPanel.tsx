import { useEffect, useMemo, useState, useCallback } from "react";
import { History, Pin, PinOff, Plus, RefreshCw, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { api, type Memory, type MemorySummary, type MemorySummarySnapshot } from "../lib/api";
import { CompactMenuSelect } from "../components/CompactMenuSelect";
import { Tooltip } from "../components/Tooltip";

const MEMORY_TYPES: Memory["memory_type"][] = ["fact", "preference"];
const SUMMARY_IDEAL_CHARS = 1500;
const SUMMARY_WARNING_CHARS = 3000;

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) { return value; }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

function getSummaryLengthTone(charCount: number) {
  if (charCount >= SUMMARY_WARNING_CHARS) {
    return {
      label: "Large",
      className: "text-amber-400",
      helper: "Large summaries can crowd out retrieved memories on local models.",
    };
  }
  if (charCount > SUMMARY_IDEAL_CHARS) {
    return {
      label: "Watch",
      className: "text-yellow-400",
      helper: "Best as dense project context; move long references into sources.",
    };
  }
  return {
    label: "Good",
    className: "text-emerald-400",
    helper: "Small enough to inject like Claude-style project memory.",
  };
}

interface WorkspaceMemoryPanelProps {
  workspaceId: string;
  onMemoryCountChange?: (count: number) => void;
  onCountsChange?: (counts: { facts: number; preferences: number }) => void;
}

export default function WorkspaceMemoryPanel({ workspaceId, onMemoryCountChange, onCountsChange }: WorkspaceMemoryPanelProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [summary, setSummary] = useState<MemorySummary | null>(null);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [summaryEditing, setSummaryEditing] = useState(false);
  const [summarySubmitting, setSummarySubmitting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [newType, setNewType] = useState<Memory["memory_type"]>("fact");
  const [submitting, setSubmitting] = useState(false);
  const [snapshots, setSnapshots] = useState<MemorySummarySnapshot[]>([]);
  // 0 = current live summary; 1..N = older snapshots (snapshots[index-1])
  const [historyIndex, setHistoryIndex] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const [deletingFacts, setDeletingFacts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMemories = useCallback(async () => {
    if (!workspaceId) { return; }
    const items = await api.memory.list(workspaceId).catch(() => []);
    setMemories(items);
  }, [workspaceId]);

  const loadSummary = useCallback(async () => {
    if (!workspaceId) { return; }
    const s = await api.memory.getSummary("workspace", workspaceId).catch(() => null);
    setSummary(s);
    if (s) { setSummaryDraft(s.content); }
  }, [workspaceId]);

  const loadSnapshots = useCallback(async () => {
    if (!workspaceId) { return; }
    const items = await api.memory.listSummarySnapshots("workspace", workspaceId).catch(() => []);
    setSnapshots(items);
    setHistoryIndex(0);
  }, [workspaceId]);

  useEffect(() => {
    loadMemories();
    loadSummary();
    loadSnapshots();
  }, [loadMemories, loadSummary, loadSnapshots]);

  const facts = useMemo(() => memories.filter((m) => m.memory_type === "fact"), [memories]);
  const preferences = useMemo(() => memories.filter((m) => m.memory_type === "preference"), [memories]);

  useEffect(() => {
    onMemoryCountChange?.(memories.length);
    onCountsChange?.({ facts: facts.length, preferences: preferences.length });
  }, [memories.length, facts.length, preferences.length, onMemoryCountChange, onCountsChange]);

  const viewingSnapshot = historyIndex > 0 ? snapshots[historyIndex - 1] : null;
  const displayedSummaryContent = viewingSnapshot ? viewingSnapshot.content : (summary?.content || "");
  const displayedTimestamp = viewingSnapshot ? viewingSnapshot.snapshotted_at : summary?.generated_at;
  const displayedIsAuto = viewingSnapshot ? viewingSnapshot.is_auto_generated : summary?.is_auto_generated;
  const summaryLengthText = summaryEditing ? summaryDraft : displayedSummaryContent;
  const summaryCharCount = summaryLengthText.trim().length;
  const summaryTokenEstimate = estimateTokens(summaryLengthText);
  const summaryLengthTone = getSummaryLengthTone(summaryCharCount);

  async function saveSummary() {
    setSummarySubmitting(true);
    try {
      const updated = await api.memory.upsertSummary("workspace", summaryDraft.trim(), workspaceId);
      setSummary(updated);
      setSummaryEditing(false);
      await loadSnapshots();
    } finally {
      setSummarySubmitting(false);
    }
  }

  async function regenerateSummary() {
    setRegenerating(true);
    try {
      const updated = await api.memory.regenerateSummary("workspace", workspaceId);
      setSummary(updated);
      setSummaryDraft(updated.content);
      setSummaryEditing(false);
      await loadSnapshots();
    } finally {
      setRegenerating(false);
    }
  }

  async function restoreCurrentSnapshot() {
    if (!viewingSnapshot) { return; }
    setRestoring(true);
    try {
      const updated = await api.memory.restoreSummarySnapshot(viewingSnapshot.id);
      setSummary(updated);
      setSummaryDraft(updated.content);
      setSummaryEditing(false);
      await loadSnapshots();
    } finally {
      setRestoring(false);
    }
  }

  async function createMemory() {
    if (!newContent.trim() || !workspaceId) { return; }
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.memory.create(newContent.trim(), "workspace", newType, workspaceId);
      setMemories((prev) => [created, ...prev]);
      setNewContent("");
      setNewType("fact");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function updateMemory(id: string, fields: { is_pinned?: boolean; is_active?: boolean }) {
    const updated = await api.memory.update(id, fields);
    setMemories((prev) => prev.map((m) => m.id === id ? updated : m));
  }

  async function deleteMemory(id: string) {
    await api.memory.delete(id);
    setMemories((prev) => prev.filter((m) => m.id !== id));
  }

  async function deleteAllFacts() {
    if (!workspaceId || facts.length === 0) { return; }
    const confirmed = window.confirm(`Delete all ${facts.length} fact${facts.length === 1 ? "" : "s"} for this workspace? Preferences will be kept.`);
    if (!confirmed) { return; }
    setDeletingFacts(true);
    try {
      await api.memory.deleteWorkspaceFacts(workspaceId);
      setMemories((prev) => prev.filter((m) => m.memory_type !== "fact"));
    } finally {
      setDeletingFacts(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="shrink-0 text-red-400/60 hover:text-red-400">✕</button>
        </div>
      )}
      <div className="space-y-4 pl-0">
          {/* Summary */}
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Summary</span>
              <div className="flex items-center gap-1.5">
                {displayedIsAuto !== undefined && (
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {viewingSnapshot ? "History" : (displayedIsAuto ? "Auto" : "Edited")}
                  </span>
                )}
                <Tooltip content="Regenerate from facts" position="top">
                  <button
                    onClick={regenerateSummary}
                    disabled={regenerating || memories.length === 0 || viewingSnapshot !== null}
                    className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
                  >
                    <RefreshCw size={12} className={regenerating ? "animate-spin" : ""} />
                  </button>
                </Tooltip>
              </div>
            </div>

            {snapshots.length > 0 && (
              <div className="mb-3 flex items-center gap-2">
                <History size={11} className="shrink-0 text-[var(--text-muted)]" />
                <input
                  type="range"
                  min={0}
                  max={snapshots.length}
                  value={historyIndex}
                  onChange={(e) => setHistoryIndex(Number(e.target.value))}
                  aria-label="Summary history"
                  className="flex-1 accent-[var(--accent-color)]"
                />
                <span className="shrink-0 text-[10px] text-[var(--text-muted)] tabular-nums">
                  {historyIndex === 0
                    ? "Now"
                    : `${historyIndex} / ${snapshots.length}`}
                </span>
              </div>
            )}

            {viewingSnapshot ? (
              <div className="space-y-2">
                <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                  {viewingSnapshot.content || "(empty)"}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-[var(--text-muted)]">
                    Snapshot from {displayedTimestamp ? formatTimestamp(displayedTimestamp) : ""}
                  </span>
                  <button
                    onClick={restoreCurrentSnapshot}
                    disabled={restoring}
                    className="rounded-md bg-[var(--accent-color)] px-2.5 py-1 text-[10px] font-medium text-white hover:opacity-90 disabled:opacity-40"
                  >
                    {restoring ? "Restoring..." : "Restore this version"}
                  </button>
                </div>
              </div>
            ) : summaryEditing ? (
              <div className="space-y-2">
                <textarea
                  value={summaryDraft}
                  onChange={(e) => setSummaryDraft(e.target.value)}
                  rows={8}
                  className="min-h-[12rem] w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2.5 py-2 text-xs leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2.5 py-2 text-[10px]">
                  <div className="flex items-center gap-2">
                    <span className={`font-semibold ${summaryLengthTone.className}`}>{summaryLengthTone.label}</span>
                    <span className="text-[var(--text-muted)]">
                      {summaryCharCount.toLocaleString()} chars · ~{summaryTokenEstimate.toLocaleString()} tokens
                    </span>
                  </div>
                  <span className="text-[var(--text-muted)]">Target under {SUMMARY_IDEAL_CHARS.toLocaleString()} chars</span>
                  <p className="basis-full text-[var(--text-muted)]">{summaryLengthTone.helper}</p>
                </div>
                <div className="flex justify-end gap-1.5">
                  <button
                    onClick={() => { setSummaryEditing(false); setSummaryDraft(summary?.content ?? ""); }}
                    className="rounded-md px-2.5 py-1 text-[10px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveSummary}
                    disabled={summarySubmitting}
                    className="rounded-md bg-[var(--accent-color)] px-2.5 py-1 text-[10px] font-medium text-white hover:opacity-90 disabled:opacity-40"
                  >
                    {summarySubmitting ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p
                  onClick={() => setSummaryEditing(true)}
                  className="cursor-pointer text-xs leading-relaxed text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                >
                  {displayedSummaryContent || "No summary yet. Click to write one, or regenerate from facts."}
                </p>
                {displayedSummaryContent && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
                    <span className={`font-semibold ${summaryLengthTone.className}`}>{summaryLengthTone.label}</span>
                    <span className="text-[var(--text-muted)]">
                      {summaryCharCount.toLocaleString()} chars · ~{summaryTokenEstimate.toLocaleString()} tokens
                    </span>
                    <span className="text-[var(--text-muted)]">Target under {SUMMARY_IDEAL_CHARS.toLocaleString()} chars</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Add Memory */}
          <div className="flex flex-col gap-2">
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Add a fact or preference..."
              rows={2}
              className="w-full resize-none rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2.5 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
            />
            <div className="flex items-center gap-2">
              <CompactMenuSelect
                label="Type"
                value={newType}
                options={MEMORY_TYPES.map((type) => ({
                  value: type,
                  label: type[0].toUpperCase() + type.slice(1),
                }))}
                onChange={(val) => setNewType(val as Memory["memory_type"])}
                widthClassName="flex-1"
              />
              <button
                onClick={createMemory}
                disabled={submitting || !newContent.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--accent-color)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Plus size={12} />
                {submitting ? "..." : "Add"}
              </button>
            </div>
          </div>

          {/* Facts */}
          {facts.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Facts ({facts.length})
                </h4>
                <button
                  type="button"
                  onClick={() => { void deleteAllFacts(); }}
                  disabled={deletingFacts}
                  className="inline-flex items-center gap-1 rounded-md border border-red-500/25 px-2 py-1 text-[10px] font-semibold text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 size={11} />
                  {deletingFacts ? "Deleting..." : "Delete all facts"}
                </button>
              </div>
              <div className="space-y-1.5">
                {facts.map((memory) => (
                  <MemoryItem key={memory.id} memory={memory} onUpdate={updateMemory} onDelete={deleteMemory} />
                ))}
              </div>
            </div>
          )}

          {/* Preferences */}
          {preferences.length > 0 && (
            <div>
              <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Preferences ({preferences.length})
              </h4>
              <div className="space-y-1.5">
                {preferences.map((memory) => (
                  <MemoryItem key={memory.id} memory={memory} onUpdate={updateMemory} onDelete={deleteMemory} />
                ))}
              </div>
            </div>
          )}

          {memories.length === 0 && (
            <p className="text-center text-xs text-[var(--text-muted)] py-4">
              No workspace memories yet. Add facts or preferences, or they&apos;ll be extracted from your chats.
            </p>
          )}
        </div>
    </div>
  );
}

function MemoryItem({
  memory,
  onUpdate,
  onDelete,
}: {
  memory: Memory;
  onUpdate: (id: string, fields: { is_pinned?: boolean; is_active?: boolean }) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      className={`rounded-lg border p-2.5 ${
        memory.is_active
          ? "border-[var(--border-color)] bg-[var(--bg-primary)]"
          : "border-[var(--border-color)]/70 opacity-60"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1 mb-1">
            {memory.is_pinned && (
              <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-400">
                Pinned
              </span>
            )}
            {!memory.is_active && (
              <span className="rounded-full bg-[var(--bg-hover)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--text-muted)]">
                Inactive
              </span>
            )}
          </div>
          <p className="text-xs leading-relaxed text-[var(--text-primary)]">{memory.content}</p>
          <p className="mt-1 text-[10px] text-[var(--text-muted)]">
            {formatTimestamp(memory.updated_at)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => onUpdate(memory.id, { is_pinned: !memory.is_pinned })}
            className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            {memory.is_pinned ? <PinOff size={11} /> : <Pin size={11} />}
          </button>
          <button
            onClick={() => onUpdate(memory.id, { is_active: !memory.is_active })}
            className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            {memory.is_active ? <ToggleRight size={12} /> : <ToggleLeft size={12} />}
          </button>
          <button
            onClick={() => onDelete(memory.id)}
            className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}
