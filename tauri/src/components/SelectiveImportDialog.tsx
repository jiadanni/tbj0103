/**
 * SelectiveImportDialog — pick which workspaces and data categories to pull
 * out of an Aetherium backup, instead of the all-or-nothing restore.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckSquare, ChevronDown, ChevronRight, Folder, RefreshCw, Search, Square, Upload, X } from "lucide-react";
import { api } from "../lib/api";
import type { BackupImportMode, BackupPreview, SelectiveImportResult } from "../lib/api";

interface SelectiveImportDialogProps {
  preview: BackupPreview;
  backupJson: string;
  onCancel: () => void;
  onImported: (result: SelectiveImportResult) => void;
}

function formatCreatedAt(value: string) {
  if (!value) {return "Unknown date";}
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {return value;}
  return parsed.toLocaleString();
}

export default function SelectiveImportDialog({
  preview,
  backupJson,
  onCancel,
  onImported,
}: SelectiveImportDialogProps) {
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<Set<string>>(
    () => new Set(preview.workspaces.map((w) => w.id)),
  );
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(() => {
    const withRows = new Set<string>();
    for (const workspace of preview.workspaces) {
      for (const category of workspace.categories) {
        if (category.row_count > 0) {withRows.add(category.id);}
      }
    }
    return withRows;
  });

  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(() => {
    const allIds = new Set<string>();
    for (const w of preview.workspaces) {
      for (const c of w.chats ?? []) {
        allIds.add(c.id);
      }
    }
    return allIds;
  });

  const [isChatsExpanded, setIsChatsExpanded] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [mode, setMode] = useState<BackupImportMode>("merge");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        onCancel();
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [busy, onCancel]);

  const availableChats = useMemo(() => {
    return preview.workspaces
      .filter((w) => selectedWorkspaces.has(w.id))
      .flatMap((w) => (w.chats ?? []).map((c) => ({ ...c, workspaceName: w.name })));
  }, [preview.workspaces, selectedWorkspaces]);

  const selectedChatCount = useMemo(() => {
    return availableChats.filter((c) => selectedChatIds.has(c.id)).length;
  }, [availableChats, selectedChatIds]);

  const filteredChats = useMemo(() => {
    const query = chatSearchQuery.trim().toLowerCase();
    if (!query) {return availableChats;}
    return availableChats.filter(
      (c) =>
        c.title.toLowerCase().includes(query) ||
        (c.folder_name && c.folder_name.toLowerCase().includes(query)) ||
        c.workspaceName.toLowerCase().includes(query),
    );
  }, [availableChats, chatSearchQuery]);

  // Category rows are summed across only the workspaces that are ticked, so the
  // counts track the workspace selection.
  const categories = useMemo(() => {
    const totals = new Map<string, { label: string; rowCount: number }>();
    for (const workspace of preview.workspaces) {
      if (!selectedWorkspaces.has(workspace.id)) {continue;}
      for (const category of workspace.categories) {
        const existing = totals.get(category.id);
        totals.set(category.id, {
          label: category.label,
          rowCount: (existing?.rowCount ?? 0) + category.row_count,
        });
      }
    }
    // Preserve the backend's category order rather than Map insertion order.
    const order = preview.workspaces[0]?.categories.map((c) => c.id) ?? [];
    return order.flatMap((id) => {
      const total = totals.get(id);
      return total ? [{ id, label: total.label, rowCount: total.rowCount }] : [];
    });
  }, [preview.workspaces, selectedWorkspaces]);

  const anyExistsLocally = preview.workspaces.some(
    (workspace) => selectedWorkspaces.has(workspace.id) && workspace.exists_locally,
  );

  const effectiveCategories = useMemo(
    () => categories.filter((c) => c.rowCount > 0 && selectedCategories.has(c.id)),
    [categories, selectedCategories],
  );

  const hasItemsToImport = useMemo(() => {
    return effectiveCategories.some((c) => {
      if (c.id === "chats") {
        return availableChats.length === 0 || selectedChatCount > 0;
      }
      return c.rowCount > 0;
    });
  }, [effectiveCategories, availableChats.length, selectedChatCount]);

  const canImport = selectedWorkspaces.size > 0 && hasItemsToImport && !busy;

  function toggleWorkspace(id: string) {
    const next = new Set(selectedWorkspaces);
    if (next.has(id)) {next.delete(id);}
    else {next.add(id);}
    setSelectedWorkspaces(next);
  }

  function toggleCategory(id: string) {
    const next = new Set(selectedCategories);
    if (next.has(id)) {next.delete(id);}
    else {next.add(id);}
    setSelectedCategories(next);
  }

  function toggleChat(id: string) {
    const next = new Set(selectedChatIds);
    if (next.has(id)) {next.delete(id);}
    else {next.add(id);}
    setSelectedChatIds(next);
  }

  function selectAllChats() {
    const next = new Set(selectedChatIds);
    for (const chat of availableChats) {
      next.add(chat.id);
    }
    setSelectedChatIds(next);
  }

  function deselectAllChats() {
    const next = new Set(selectedChatIds);
    for (const chat of availableChats) {
      next.delete(chat.id);
    }
    setSelectedChatIds(next);
  }

  async function runImport() {
    setBusy(true);
    setError(null);
    try {
      const chatIdsToPass =
        availableChats.length > 0 && selectedCategories.has("chats")
          ? availableChats.filter((c) => selectedChatIds.has(c.id)).map((c) => c.id)
          : undefined;

      const result =
        chatIdsToPass !== undefined
          ? await api.backup.importSelective(
              backupJson,
              Array.from(selectedWorkspaces),
              effectiveCategories.map((c) => c.id),
              mode,
              chatIdsToPass,
            )
          : await api.backup.importSelective(
              backupJson,
              Array.from(selectedWorkspaces),
              effectiveCategories.map((c) => c.id),
              mode,
            );
      onImported(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={() => {
        if (!busy) {onCancel();}
      }}
    >
      <div
        className="mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col gap-5 rounded-3xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[var(--text-primary)]">Import from backup</h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Created {formatCreatedAt(preview.created_at)}
              {preview.app_version ? ` · app ${preview.app_version}` : ""}
              {" · "}
              {preview.workspaces.length} workspace{preview.workspaces.length === 1 ? "" : "s"}
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-[var(--border-color)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)]">
            {preview.is_global ? "Global backup" : "Workspace backup"}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
          {/* ── Workspaces (only meaningful when the file holds several) ── */}
          {preview.workspaces.length > 1 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--text-primary)]">
                  Workspaces ({selectedWorkspaces.size}/{preview.workspaces.length})
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedWorkspaces(new Set(preview.workspaces.map((w) => w.id)))}
                    className="text-xs text-[var(--accent-color)] hover:underline"
                  >
                    All
                  </button>
                  <button
                    onClick={() => setSelectedWorkspaces(new Set())}
                    className="text-xs text-[var(--text-muted)] hover:underline"
                  >
                    None
                  </button>
                </div>
              </div>
              <div className="max-h-52 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]">
                {preview.workspaces.map((workspace) => {
                  const checked = selectedWorkspaces.has(workspace.id);
                  const summary = workspace.categories
                    .filter((c) => c.row_count > 0)
                    .map((c) => `${c.row_count} ${c.label.toLowerCase()}`)
                    .join(" · ");
                  return (
                    <div
                      key={workspace.id}
                      onClick={() => toggleWorkspace(workspace.id)}
                      className="flex cursor-pointer items-center gap-2.5 border-b border-[var(--border-color)] px-3 py-2 last:border-b-0 hover:bg-[var(--bg-hover)]"
                    >
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        aria-label={workspace.name}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleWorkspace(workspace.id);
                        }}
                        className="shrink-0 text-[var(--accent-color)]"
                      >
                        {checked ? <CheckSquare size={16} /> : <Square size={16} className="text-[var(--text-muted)]" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-[var(--text-primary)]">
                          {workspace.name}
                        </p>
                        {summary && (
                          <p className="truncate text-[10px] text-[var(--text-secondary)]">{summary}</p>
                        )}
                      </div>
                      {workspace.exists_locally && checked && mode === "replace" && (
                        <span className="shrink-0 text-[10px] text-amber-500">will be replaced</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Data categories ── */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-[var(--text-primary)]">What to import</span>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {categories.map((category) => {
                const empty = category.rowCount === 0;
                const checked = !empty && selectedCategories.has(category.id);
                return (
                  <button
                    key={category.id}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    disabled={empty}
                    onClick={() => toggleCategory(category.id)}
                    className="flex items-center gap-2.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-left hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="shrink-0 text-[var(--accent-color)]">
                      {checked ? <CheckSquare size={16} /> : <Square size={16} className="text-[var(--text-muted)]" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-primary)]">
                      {category.label}
                    </span>
                    <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
                      {category.id === "chats" && availableChats.length > 0 && checked
                        ? `${selectedChatCount}/${availableChats.length} chats`
                        : category.rowCount}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Individual Chats Picker ── */}
          {selectedCategories.has("chats") && availableChats.length > 0 && (
            <div className="flex flex-col gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3.5">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setIsChatsExpanded(!isChatsExpanded)}
                  className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-primary)] hover:text-[var(--accent-color)]"
                >
                  {isChatsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span>Individual chats ({selectedChatCount}/{availableChats.length} selected)</span>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllChats}
                    className="text-xs text-[var(--accent-color)] hover:underline"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={deselectAllChats}
                    className="text-xs text-[var(--text-muted)] hover:underline"
                  >
                    None
                  </button>
                </div>
              </div>

              {isChatsExpanded && (
                <div className="mt-1 flex flex-col gap-2">
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                    <input
                      type="text"
                      placeholder="Filter chats by title, folder, or workspace..."
                      value={chatSearchQuery}
                      onChange={(e) => setChatSearchQuery(e.target.value)}
                      className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] py-1.5 pl-8 pr-7 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-color)] focus:outline-none"
                    />
                    {chatSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setChatSearchQuery("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>

                  <div className="max-h-52 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)]">
                    {filteredChats.length === 0 ? (
                      <div className="p-4 text-center text-xs text-[var(--text-muted)]">
                        No chats match your filter.
                      </div>
                    ) : (
                      filteredChats.map((chat) => {
                        const checked = selectedChatIds.has(chat.id);
                        return (
                          <div
                            key={chat.id}
                            onClick={() => toggleChat(chat.id)}
                            className="flex cursor-pointer items-center gap-2.5 border-b border-[var(--border-color)] px-3 py-2 last:border-b-0 hover:bg-[var(--bg-hover)]"
                          >
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={checked}
                              aria-label={chat.title}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleChat(chat.id);
                              }}
                              className="shrink-0 text-[var(--accent-color)]"
                            >
                              {checked ? (
                                <CheckSquare size={15} />
                              ) : (
                                <Square size={15} className="text-[var(--text-muted)]" />
                              )}
                            </button>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium text-[var(--text-primary)]">
                                {chat.title}
                              </p>
                              <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-muted)]">
                                <span>{chat.message_count} {chat.message_count === 1 ? "message" : "messages"}</span>
                                {chat.folder_name && (
                                  <span className="flex items-center gap-1">
                                    <Folder size={10} />
                                    <span>{chat.folder_name}</span>
                                  </span>
                                )}
                                {preview.workspaces.length > 1 && (
                                  <span className="rounded bg-[var(--bg-primary)] px-1.5 py-0.5 text-[var(--text-secondary)]">
                                    {chat.workspaceName}
                                  </span>
                                )}
                                {chat.updated_at && (
                                  <span>{formatCreatedAt(chat.updated_at)}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Conflict handling (only when something would collide) ── */}
          {anyExistsLocally && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-[var(--text-primary)]">
                Some of these workspaces already exist
              </span>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === "merge"}
                  onChange={() => setMode("merge")}
                  className="mt-0.5 accent-[var(--accent-color)]"
                />
                <span className="min-w-0">
                  <span className="block text-xs text-[var(--text-primary)]">
                    Merge — keep existing, add what&apos;s missing
                  </span>
                  <span className="block text-[10px] text-[var(--text-secondary)]">
                    Nothing is deleted. Where an item exists in both, your current copy is kept.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === "replace"}
                  onChange={() => setMode("replace")}
                  className="mt-0.5 accent-red-500"
                />
                <span className="min-w-0">
                  <span className="block text-xs text-[var(--text-primary)]">
                    Replace workspace — delete existing data first
                  </span>
                  <span className="block text-[10px] text-[var(--text-secondary)]">
                    Everything currently in the workspace is removed, then only the categories you
                    ticked above are restored.
                  </span>
                </span>
              </label>
            </div>
          )}

          {mode === "replace" && anyExistsLocally && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
              <p className="text-[11px] text-[var(--text-secondary)]">
                Data in the selected workspaces that is not in this backup — or is in a category you
                unticked — will be lost.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-[var(--text-muted)]">
            {effectiveCategories.reduce((total, c) => total + c.rowCount, 0)} items from{" "}
            {selectedWorkspaces.size} workspace{selectedWorkspaces.size === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-color)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X size={14} />
              Cancel
            </button>
            <button
              onClick={() => void runImport()}
              disabled={!canImport}
              className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${
                mode === "replace" ? "bg-red-500" : "bg-[var(--accent-color)]"
              }`}
            >
              {busy ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
              {busy ? "Importing..." : mode === "replace" ? "Replace & import" : "Import"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
