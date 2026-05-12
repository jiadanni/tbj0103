import { useEffect, useMemo, useState, useCallback } from "react";
import { Brain, Pin, PinOff, Plus, RefreshCw, Trash2, ToggleLeft, ToggleRight, ChevronDown, ChevronRight } from "lucide-react";
import { api, type Memory, type MemorySummary } from "../lib/api";
import CompactMenuSelect from "../components/CompactMenuSelect";
import Tooltip from "../components/Tooltip";

const MEMORY_TYPES: Memory["memory_type"][] = ["fact", "preference"];

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

interface WorkspaceMemoryPanelProps {
  workspaceId: string;
}

export default function WorkspaceMemoryPanel({ workspaceId }: WorkspaceMemoryPanelProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [summary, setSummary] = useState<MemorySummary | null>(null);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [summaryEditing, setSummaryEditing] = useState(false);
  const [summarySubmitting, setSummarySubmitting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [newType, setNewType] = useState<Memory["memory_type"]>("fact");
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const loadMemories = useCallback(async () => {
    if (!workspaceId) return;
    const items = await api.memory.list(workspaceId).catch(() => []);
    setMemories(items);
  }, [workspaceId]);

  const loadSummary = useCallback(async () => {
    if (!workspaceId) return;
    const s = await api.memory.getSummary("workspace", workspaceId).catch(() => null);
    setSummary(s);
    if (s) setSummaryDraft(s.content);
  }, [workspaceId]);

  useEffect(() => {
    loadMemories();
    loadSummary();
  }, [loadMemories, loadSummary]);

  const facts = useMemo(() => memories.filter((m) => m.memory_type === "fact"), [memories]);
  const preferences = useMemo(() => memories.filter((m) => m.memory_type === "preference"), [memories]);

  async function saveSummary() {
    setSummarySubmitting(true);
    try {
      const updated = await api.memory.upsertSummary("workspace", summaryDraft.trim(), workspaceId);
      setSummary(updated);
      setSummaryEditing(false);
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
    } finally {
      setRegenerating(false);
    }
  }

  async function createMemory() {
    if (!newContent.trim() || !workspaceId) return;
    setSubmitting(true);
    try {
      const created = await api.memory.create(newContent.trim(), "workspace", newType, workspaceId);
      setMemories((prev) => [created, ...prev]);
      setNewContent("");
      setNewType("fact");
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

  return (
    <div className="space-y-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Brain size={12} /> Workspace Memory
        <span className="ml-1 text-[var(--text-muted)]">({memories.length})</span>
      </button>

      {expanded && (
        <div className="space-y-4 pl-0">
          {/* Summary */}
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Summary</span>
              <div className="flex items-center gap-1.5">
                {summary && (
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {summary.is_auto_generated ? "Auto" : "Edited"}
                  </span>
                )}
                <Tooltip content="Regenerate from facts" position="top">
                  <button
                    onClick={regenerateSummary}
                    disabled={regenerating || memories.length === 0}
                    className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
                  >
                    <RefreshCw size={12} className={regenerating ? "animate-spin" : ""} />
                  </button>
                </Tooltip>
              </div>
            </div>
            {summaryEditing ? (
              <div className="space-y-2">
                <textarea
                  value={summaryDraft}
                  onChange={(e) => setSummaryDraft(e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2.5 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                />
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
              <p
                onClick={() => setSummaryEditing(true)}
                className="cursor-pointer text-xs leading-relaxed text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              >
                {summary?.content || "No summary yet. Click to write one, or regenerate from facts."}
              </p>
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
              <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Facts ({facts.length})
              </h4>
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
              No workspace memories yet. Add facts or preferences, or they'll be extracted from your chats.
            </p>
          )}
        </div>
      )}
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
