/**
 * BoomScrollExportSection — export flashcards from selected workspaces as a
 * Boom Scroll deck file for the mobile companion app.
 */
import { useMemo, useState } from "react";
import { message, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { RefreshCw, Smartphone } from "lucide-react";
import { api } from "../lib/api";
import { useWorkspaceStore, type Workspace } from "../stores/workspaceStore";
import SuccessDialog from "../components/SuccessDialog";

function sanitizeFilenamePart(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "deck";
}

/** Parents first, each followed by its sub-workspaces (marked with a depth of 1). */
function orderForPicker(workspaces: Workspace[]): Array<{ workspace: Workspace; depth: number }> {
  const visible = workspaces.filter((w) => !w.is_hidden);
  const roots = visible.filter((w) => !w.parent_workspace_id);
  const result: Array<{ workspace: Workspace; depth: number }> = [];
  for (const root of roots) {
    result.push({ workspace: root, depth: 0 });
    for (const child of visible.filter((w) => w.parent_workspace_id === root.id)) {
      result.push({ workspace: child, depth: 1 });
    }
  }
  // Orphaned sub-workspaces (hidden or missing parent) still get listed.
  const seen = new Set(result.map((r) => r.workspace.id));
  for (const leftover of visible.filter((w) => !seen.has(w.id))) {
    result.push({ workspace: leftover, depth: 0 });
  }
  return result;
}

export default function BoomScrollExportSection() {
  const { workspaces } = useWorkspaceStore();
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successDialog, setSuccessDialog] = useState<{ title: string; description: string } | null>(null);

  const picker = useMemo(() => orderForPicker(workspaces), [workspaces]);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(picker.map((entry) => entry.workspace.id)),
  );

  const allSelected = picker.length > 0 && picker.every((entry) => selected.has(entry.workspace.id));
  const selectedCount = picker.filter((entry) => selected.has(entry.workspace.id)).length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(picker.map((entry) => entry.workspace.id)));
  }

  async function exportDeck() {
    const ids = picker.map((entry) => entry.workspace.id).filter((id) => selected.has(id));
    if (ids.length === 0) {return;}

    setError(null);
    const single = ids.length === 1 ? workspaces.find((w) => w.id === ids[0]) : null;
    const baseName = single ? sanitizeFilenamePart(single.name) : "aetherium";
    const destination = await save({
      title: "Save Boom Scroll deck",
      defaultPath: `${baseName}-boomscroll.json`,
      filters: [{ name: "Boom Scroll Deck", extensions: ["json"] }],
    });
    if (!destination) {return;}

    setExporting(true);
    try {
      const deckJson = await api.export.feedDeck(ids);
      await writeTextFile(destination, deckJson);
      setSuccessDialog({
        title: "Deck exported",
        description: `Saved a Boom Scroll deck with flashcards from ${ids.length} workspace${ids.length === 1 ? "" : "s"}. Move the file to your phone and open it in the Boom Scroll app.`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "Export failed";
      setError(msg);
      await message(msg, { title: "Export failed", kind: "error" });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="w-full">
      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Smartphone size={16} className="text-[var(--accent-color)]" />
              <h2 className="text-sm font-medium text-[var(--text-primary)]">Boom Scroll Deck</h2>
            </div>
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              Export flashcards from the selected workspaces as a deck file for the Boom Scroll
              mobile companion app. Everything stays local — transfer the file to your phone yourself.
            </p>
          </div>

          <button
            onClick={() => void exportDeck()}
            disabled={exporting || selectedCount === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-color)] px-3 py-2 text-xs text-white hover:opacity-90 disabled:opacity-40"
          >
            {exporting ? <RefreshCw size={12} className="animate-spin" /> : <Smartphone size={12} />}
            {exporting ? "Exporting..." : "Export"}
          </button>
        </div>

        <div className="mt-4 border-t border-[var(--border-color)] pt-3">
          <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            <span className="font-medium">All workspaces</span>
            <span className="text-[var(--text-muted)]">({selectedCount} of {picker.length} selected)</span>
          </label>
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {picker.map(({ workspace, depth }) => (
              <li key={workspace.id} style={{ paddingLeft: depth * 20 }}>
                <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={selected.has(workspace.id)}
                    onChange={() => toggle(workspace.id)}
                  />
                  {workspace.name}
                </label>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {successDialog && (
        <SuccessDialog
          title={successDialog.title}
          description={successDialog.description}
          onConfirm={() => setSuccessDialog(null)}
        />
      )}
    </div>
  );
}
