import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Brain, Globe, Pin, PinOff, Plus, RefreshCw, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { api, type Memory, type MemorySummary } from "../lib/api";
import { CompactMenuSelect } from "../components/CompactMenuSelect";
import { Tooltip } from "../components/Tooltip";
import HoverDefinitionSurface from "../components/HoverDefinitionSurface";
import { useWorkspaceStore } from "../stores/workspaceStore";

const MEMORY_TYPES: Memory["memory_type"][] = ["fact", "preference"];

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default function GlobalMemoryView() {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [summary, setSummary] = useState<MemorySummary | null>(null);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [summaryEditing, setSummaryEditing] = useState(false);
  const [summarySubmitting, setSummarySubmitting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [newType, setNewType] = useState<Memory["memory_type"]>("fact");
  const [submitting, setSubmitting] = useState(false);

  const loadMemories = useCallback(async () => {
    const items = await api.memory.listGlobal().catch(() => []);
    setMemories(items);
  }, []);

  const loadSummary = useCallback(async () => {
    const s = await api.memory.getSummary("global").catch(() => null);
    setSummary(s);
    if (s) {
      setSummaryDraft(s.content);
    }
  }, []);

  useEffect(() => {
    loadMemories();
    loadSummary();
  }, [loadMemories, loadSummary]);

  const facts = useMemo(() => memories.filter((m) => m.memory_type === "fact"), [memories]);
  const preferences = useMemo(() => memories.filter((m) => m.memory_type === "preference"), [memories]);

  const counts = useMemo(() => ({
    total: memories.length,
    active: memories.filter((m) => m.is_active).length,
    pinned: memories.filter((m) => m.is_pinned).length,
  }), [memories]);

  async function saveSummary() {
    setSummarySubmitting(true);
    try {
      const updated = await api.memory.upsertSummary("global", summaryDraft.trim());
      setSummary(updated);
      setSummaryEditing(false);
    } finally {
      setSummarySubmitting(false);
    }
  }

  async function regenerateSummary() {
    setRegenerating(true);
    try {
      const updated = await api.memory.regenerateSummary("global");
      setSummary(updated);
      setSummaryDraft(updated.content);
      setSummaryEditing(false);
    } finally {
      setRegenerating(false);
    }
  }

  async function createMemory() {
    if (!newContent.trim()) {
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.memory.create(newContent.trim(), "global", newType);
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

  async function deactivateAll() {
    await api.memory.deactivateAll("", "global");
    loadMemories();
  }

  async function deleteAll() {
    await api.memory.deleteAll("", "global");
    setMemories([]);
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-primary)]">
      <div className="border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]">
        <div className="app-container flex flex-col gap-5 py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 text-[var(--text-primary)]">
                <Globe size={18} className="text-[var(--accent-color)]" />
                <h2 className="text-lg font-semibold">Global Memory</h2>
              </div>
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                Facts and preferences shared across all workspaces.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center lg:w-[360px]">
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3">
                <div className="text-lg font-semibold text-[var(--text-primary)]">{counts.total}</div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Total</div>
              </div>
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3">
                <div className="text-lg font-semibold text-[var(--text-primary)]">{counts.active}</div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Active</div>
              </div>
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3">
                <div className="text-lg font-semibold text-[var(--text-primary)]">{counts.pinned}</div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Pinned</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="app-container space-y-6 py-6">
          {/* Summary Section */}
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Summary</h3>
              <div className="flex items-center gap-2">
                {summary && (
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {summary.is_auto_generated ? "Auto-generated" : "Manually edited"} {formatTimestamp(summary.edited_at ?? summary.generated_at)}
                  </span>
                )}
                <Tooltip content="Regenerate summary from facts" position="top">
                  <button
                    onClick={regenerateSummary}
                    disabled={regenerating || memories.length === 0}
                    className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
                  >
                    <RefreshCw size={14} className={regenerating ? "animate-spin" : ""} />
                  </button>
                </Tooltip>
              </div>
            </div>
            {summaryEditing ? (
              <div className="space-y-2">
                <textarea
                  value={summaryDraft}
                  onChange={(e) => setSummaryDraft(e.target.value)}
                  rows={4}
                  className="w-full resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { setSummaryEditing(false); setSummaryDraft(summary?.content ?? ""); }}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveSummary}
                    disabled={summarySubmitting}
                    className="rounded-lg bg-[var(--accent-color)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {summarySubmitting ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            ) : (
              <HoverDefinitionSurface
                workspaceId={activeWorkspaceId}
                as="p"
                onClick={() => setSummaryEditing(true)}
                className="cursor-pointer whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              >
                {summary?.content || "No summary yet. Add some facts and click regenerate, or click here to write one."}
              </HoverDefinitionSurface>
            )}
          </div>

          {/* Add Memory */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Add something worth remembering across all workspaces..."
              rows={3}
              className="w-full resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] lg:flex-1"
            />
            <CompactMenuSelect
              label="Type"
              value={newType}
              options={MEMORY_TYPES.map((type) => ({
                value: type,
                label: type[0].toUpperCase() + type.slice(1),
              }))}
              onChange={(val) => setNewType(val as Memory["memory_type"])}
              widthClassName="lg:w-[180px]"
            />
            <button
              onClick={createMemory}
              disabled={submitting || !newContent.trim()}
              className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--accent-color)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 lg:w-[180px]"
            >
              <Plus size={14} />
              {submitting ? "Saving..." : "Add memory"}
            </button>
          </div>

          {/* Bulk actions */}
          {memories.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={deactivateAll}
                disabled={counts.active === 0}
                className="flex items-center gap-1.5 rounded-xl border border-[var(--border-color)] px-3 py-2 text-xs font-medium text-[var(--text-muted)] transition-colors hover:border-amber-500/50 hover:text-amber-400 disabled:opacity-40"
              >
                <ToggleLeft size={13} />
                Deactivate All
              </button>
              <button
                onClick={deleteAll}
                className="flex items-center gap-1.5 rounded-xl border border-[var(--border-color)] px-3 py-2 text-xs font-medium text-[var(--text-muted)] transition-colors hover:border-red-500/50 hover:text-red-400"
              >
                <Trash2 size={13} />
                Delete All
              </button>
            </div>
          )}

          {/* Facts Section */}
          <MemorySection
            title="Facts"
            icon={<Brain size={14} />}
            items={facts}
            workspaceId={activeWorkspaceId}
            emptyMessage="No facts yet. Facts are objective information about you."
            onUpdate={updateMemory}
            onDelete={deleteMemory}
          />

          {/* Preferences Section */}
          <MemorySection
            title="Preferences"
            icon={<Globe size={14} />}
            items={preferences}
            workspaceId={activeWorkspaceId}
            emptyMessage="No preferences yet. Preferences describe how you want to be communicated with."
            onUpdate={updateMemory}
            onDelete={deleteMemory}
          />
        </div>
      </div>
    </div>
  );
}

function MemorySection({
  title,
  icon,
  items,
  workspaceId,
  emptyMessage,
  onUpdate,
  onDelete,
}: {
  title: string;
  icon: React.ReactNode;
  items: Memory[];
  workspaceId?: string | null;
  emptyMessage: string;
  onUpdate: (id: string, fields: { is_pinned?: boolean; is_active?: boolean }) => void;
  onDelete: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div>
        <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
          {icon} {title}
        </h3>
        <p className="text-sm text-[var(--text-muted)]">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
        {icon} {title} <span className="text-[var(--text-muted)]">({items.length})</span>
      </h3>
      <div className="space-y-2">
        {items.map((memory) => (
          <div
            key={memory.id}
            className={`rounded-xl border p-3 ${
              memory.is_active
                ? "border-[var(--border-color)] bg-[var(--bg-elevated)]"
                : "border-[var(--border-color)]/70 bg-[var(--bg-primary)] opacity-70"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  {memory.is_pinned && (
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                      Pinned
                    </span>
                  )}
                  {!memory.is_active && (
                    <span className="rounded-full bg-[var(--bg-hover)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
                      Inactive
                    </span>
                  )}
                </div>
                <HoverDefinitionSurface workspaceId={workspaceId} as="div" className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-primary)]">
                  {memory.content}
                </HoverDefinitionSurface>
                <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                  Updated {formatTimestamp(memory.updated_at)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <Tooltip content={memory.is_pinned ? "Unpin" : "Pin"} position="top">
                  <button
                    onClick={() => onUpdate(memory.id, { is_pinned: !memory.is_pinned })}
                    className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  >
                    {memory.is_pinned ? <PinOff size={13} /> : <Pin size={13} />}
                  </button>
                </Tooltip>
                <Tooltip content={memory.is_active ? "Deactivate" : "Activate"} position="top">
                  <button
                    onClick={() => onUpdate(memory.id, { is_active: !memory.is_active })}
                    className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  >
                    {memory.is_active ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                  </button>
                </Tooltip>
                <Tooltip content="Delete" position="top">
                  <button
                    onClick={() => onDelete(memory.id)}
                    className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-400"
                  >
                    <Trash2 size={13} />
                  </button>
                </Tooltip>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
