import { useEffect, useMemo, useState, useCallback } from "react";
import { Brain, Globe, Layers, Pin, PinOff, Plus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { api, type Memory } from "../lib/api";
import { useScopedWorkspace } from "../lib/workspacePane";

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
    if (!newContent.trim()) return;
    if (scopeTab === "workspace" && !activeWorkspaceId) return;

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

  const isWorkspaceDisabled = scopeTab === "workspace" && !activeWorkspaceId;

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-72 border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] flex flex-col">
        <div className="px-4 py-3 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2 text-[var(--text-primary)]">
            <Brain size={15} className="text-[var(--accent-color)]" />
            <h2 className="text-sm font-semibold">Memory</h2>
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {scopeTab === "global"
              ? "Facts and preferences shared across all workspaces."
              : "Workspace-scoped facts, preferences, and context for this workspace."}
          </p>
        </div>

        {/* Scope tabs */}
        <div className="flex border-b border-[var(--border-color)]">
          <button
            onClick={() => setScopeTab("workspace")}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${
              scopeTab === "workspace"
                ? "text-[var(--accent-color)] border-b-2 border-[var(--accent-color)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            <Layers size={13} />
            Workspace
          </button>
          <button
            onClick={() => setScopeTab("global")}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${
              scopeTab === "global"
                ? "text-[var(--accent-color)] border-b-2 border-[var(--accent-color)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            <Globe size={13} />
            Global
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 px-4 py-3 border-b border-[var(--border-color)] text-center">
          <div className="rounded-lg bg-[var(--bg-elevated)] p-2">
            <div className="text-sm font-semibold text-[var(--text-primary)]">{counts.total}</div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Total</div>
          </div>
          <div className="rounded-lg bg-[var(--bg-elevated)] p-2">
            <div className="text-sm font-semibold text-[var(--text-primary)]">{counts.active}</div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Active</div>
          </div>
          <div className="rounded-lg bg-[var(--bg-elevated)] p-2">
            <div className="text-sm font-semibold text-[var(--text-primary)]">{counts.pinned}</div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Pinned</div>
          </div>
        </div>

        <div className="p-4 space-y-3">
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder={scopeTab === "global"
              ? "Add something worth remembering across all workspaces..."
              : "Add something worth remembering about this workspace..."}
            rows={4}
            className="w-full resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
          />
          <div className="relative">
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              className="h-10 w-full appearance-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
            >
              {MEMORY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type[0].toUpperCase() + type.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={createMemory}
            disabled={submitting || !newContent.trim() || isWorkspaceDisabled}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent-color)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Plus size={14} />
            {submitting ? "Saving..." : "Add memory"}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
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
          <div className="p-5 space-y-3">
            {memories.map((memory) => (
              <div
                key={memory.id}
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
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-primary)]">
                      {memory.content}
                    </p>
                    <p className="mt-3 text-[11px] text-[var(--text-muted)]">
                      Updated {formatTimestamp(memory.updated_at)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => updateMemory(memory.id, { is_pinned: !memory.is_pinned })}
                      className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      title={memory.is_pinned ? "Unpin memory" : "Pin memory"}
                    >
                      {memory.is_pinned ? <PinOff size={14} /> : <Pin size={14} />}
                    </button>
                    <button
                      onClick={() => updateMemory(memory.id, { is_active: !memory.is_active })}
                      className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      title={memory.is_active ? "Deactivate memory" : "Activate memory"}
                    >
                      {memory.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                    </button>
                    <button
                      onClick={() => deleteMemory(memory.id)}
                      className="rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-400"
                      title="Delete memory"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
