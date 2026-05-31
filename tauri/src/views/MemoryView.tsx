import { useEffect, useMemo, useState, useCallback } from "react";
import { Brain, Globe, Layers, Pin, PinOff, Plus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { api, type Memory } from "../lib/api";
import { useScopedWorkspace } from "../lib/workspacePane";
import { CompactMenuSelect } from "../components/CompactMenuSelect";
import { Tooltip } from "../components/Tooltip";
import HoverDefinitionSurface from "../components/HoverDefinitionSurface";

const MEMORY_TYPES: Memory["memory_type"][] = ["fact", "preference", "context"];

type ScopeTab = "workspace" | "global";

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

export default function MemoryView() {
  const { activeWorkspaceId } = useScopedWorkspace();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [newContent, setNewContent] = useState("");
  const [newType, setNewType] = useState<Memory["memory_type"]>("fact");
  const [submitting, setSubmitting] = useState(false);
  const [scopeTab, setScopeTab] = useState<ScopeTab>("workspace");

  const loadMemories = useCallback(async () => {
    if (scopeTab === "global") {
      const items = await api.memory.listGlobal().catch(() => []);
      setMemories(items);
    } else {
      if (!activeWorkspaceId) {
        setMemories([]);
        return;
      }
      const items = await api.memory.list(activeWorkspaceId).catch(() => []);
      setMemories(items);
    }
  }, [scopeTab, activeWorkspaceId]);

  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  const counts = useMemo(() => ({
    total: memories.length,
    active: memories.filter((memory) => memory.is_active).length,
    pinned: memories.filter((memory) => memory.is_pinned).length,
  }), [memories]);

  async function createMemory() {
    if (!newContent.trim()) {return;}
    if (scopeTab === "workspace" && !activeWorkspaceId) {return;}

    setSubmitting(true);
    try {
      const created = await api.memory.create(
        newContent.trim(),
        scopeTab,
        newType,
        scopeTab === "workspace" ? activeWorkspaceId ?? undefined : undefined,
      );
      setMemories((prev) => [created, ...prev]);
      setNewContent("");
      setNewType("fact");
    } finally {
      setSubmitting(false);
    }
  }

  async function updateMemory(id: string, fields: { is_pinned?: boolean; is_active?: boolean }) {
    const updated = await api.memory.update(id, fields);
    setMemories((prev) => prev.map((memory) => memory.id === id ? updated : memory));
  }

  async function deleteMemory(id: string) {
    await api.memory.delete(id);
    setMemories((prev) => prev.filter((memory) => memory.id !== id));
  }

  async function deactivateAll() {
    if (!activeWorkspaceId && scopeTab === "workspace") { return; }
    await api.memory.deactivateAll(activeWorkspaceId ?? "", scopeTab);
    loadMemories();
  }

  async function deleteAll() {
    if (!activeWorkspaceId && scopeTab === "workspace") { return; }
    await api.memory.deleteAll(activeWorkspaceId ?? "", scopeTab);
    setMemories([]);
  }

  const isWorkspaceDisabled = scopeTab === "workspace" && !activeWorkspaceId;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-primary)]">
      <div className="border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]">
        <div className="app-container flex flex-col gap-5 py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 text-[var(--text-primary)]">
                <Brain size={18} className="text-[var(--accent-color)]" />
                <h2 className="text-lg font-semibold">Memory</h2>
              </div>
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                {scopeTab === "global"
                  ? "Facts and preferences shared across all workspaces."
                  : "Workspace-scoped facts, preferences, and context for this workspace."}
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

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setScopeTab("workspace")}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                scopeTab === "workspace"
                  ? "border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--accent-color)]"
                  : "border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              <Layers size={13} />
              Workspace
            </button>
            <button
              onClick={() => setScopeTab("global")}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                scopeTab === "global"
                  ? "border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--accent-color)]"
                  : "border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              <Globe size={13} />
              Global
            </button>

            {memories.length > 0 && (
              <>
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
              </>
            )}
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder={scopeTab === "global"
                ? "Add something worth remembering across all workspaces..."
                : "Add something worth remembering about this workspace..."}
              rows={4}
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
              disabled={submitting || !newContent.trim() || isWorkspaceDisabled}
              className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--accent-color)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 lg:w-[180px]"
            >
              <Plus size={14} />
              {submitting ? "Saving..." : "Add memory"}
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isWorkspaceDisabled ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
            Select a workspace to view workspace memory.
          </div>
        ) : memories.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <div>
              {scopeTab === "global" ? <Globe size={28} className="mx-auto mb-3 text-[var(--text-muted)]" /> : <Brain size={28} className="mx-auto mb-3 text-[var(--text-muted)]" />}
              <p className="text-sm text-[var(--text-secondary)]">
                No {scopeTab} memories yet
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {scopeTab === "global"
                  ? "Add global facts or preferences here — they'll be available in every workspace."
                  : "Add durable facts or preferences here to make future chats more context-aware."}
              </p>
            </div>
          </div>
        ) : (
          <div className="app-container space-y-3 py-6">
            {memories.map((memory) => (
              <MemoryCard
                key={memory.id}
                memory={memory}
                workspaceId={activeWorkspaceId}
                onUpdate={updateMemory}
                onDelete={deleteMemory}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MemoryCard({
  memory,
  workspaceId,
  onUpdate,
  onDelete,
}: {
  memory: Memory;
  workspaceId?: string | null;
  onUpdate: (id: string, fields: { is_pinned?: boolean; is_active?: boolean }) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        memory.is_active
          ? "border-[var(--border-color)] bg-[var(--bg-elevated)]"
          : "border-[var(--border-color)]/70 bg-[var(--bg-primary)] opacity-70"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[var(--accent-color)]/12 px-2.5 py-1 text-[11px] font-medium capitalize text-[var(--accent-color)]">
              {memory.memory_type}
            </span>
            {memory.scope === "global" && (
              <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-[11px] font-medium text-blue-400">
                Global
              </span>
            )}
            {memory.is_pinned && (
              <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-400">
                Pinned
              </span>
            )}
            {!memory.is_active && (
              <span className="rounded-full bg-[var(--bg-hover)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-muted)]">
                Inactive
              </span>
            )}
            {memory.reinforcement_count > 1 && (
              <Tooltip
                content={`Restated ${memory.reinforcement_count} times${memory.last_reinforced_at ? ` (last ${formatTimestamp(memory.last_reinforced_at)})` : ""}`}
                position="top"
              >
                <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
                  Reinforced ×{memory.reinforcement_count}
                </span>
              </Tooltip>
            )}
            {memory.superseded_by && (
              <Tooltip
                content={`Replaced by a newer memory${memory.superseded_at ? ` on ${formatTimestamp(memory.superseded_at)}` : ""}${memory.superseded_reason ? ` (${memory.superseded_reason})` : ""}`}
                position="top"
              >
                <span className="rounded-full bg-purple-500/10 px-2.5 py-1 text-[11px] font-medium text-purple-400">
                  Superseded
                </span>
              </Tooltip>
            )}
          </div>
          <HoverDefinitionSurface workspaceId={workspaceId} as="div" className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-primary)]">
            {memory.content}
          </HoverDefinitionSurface>
          <p className="mt-3 text-[11px] text-[var(--text-muted)]">
            Updated {formatTimestamp(memory.updated_at)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Tooltip content={memory.is_pinned ? "Unpin memory" : "Pin memory"} position="top">
            <button
              onClick={() => onUpdate(memory.id, { is_pinned: !memory.is_pinned })}
              className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              {memory.is_pinned ? <PinOff size={14} /> : <Pin size={14} />}
            </button>
          </Tooltip>
          <Tooltip content={memory.is_active ? "Deactivate memory" : "Activate memory"} position="top">
            <button
              onClick={() => onUpdate(memory.id, { is_active: !memory.is_active })}
              className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              {memory.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
            </button>
          </Tooltip>
          <Tooltip content="Delete memory" position="top">
            <button
              onClick={() => onDelete(memory.id)}
              className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-400"
            >
              <Trash2 size={14} />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
