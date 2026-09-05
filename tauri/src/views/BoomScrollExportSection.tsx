/**
 * BoomScrollExportSection — export flashcards from selected workspaces as a
 * Boom Scroll deck file for the mobile companion app.
 */
import { useEffect, useMemo, useState } from "react";
import { message, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { RefreshCw, Smartphone } from "lucide-react";
import { api } from "../lib/api";
import { useWorkspaceStore, type Workspace } from "../stores/workspaceStore";
import SuccessDialog from "../components/SuccessDialog";
import BoomScrollExportDialog from "../components/BoomScrollExportDialog";

function sanitizeFilenamePart(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "deck";
}

function timestampForFilename(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
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
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successDialog, setSuccessDialog] = useState<{ title: string; description: string } | null>(null);
  const [cardCounts, setCardCounts] = useState<Record<string, number>>({});
  const [pickerOpen, setPickerOpen] = useState(false);

  const picker = useMemo(() => orderForPicker(workspaces), [workspaces]);

  useEffect(() => {
    let active = true;
    async function loadCounts() {
      const counts: Record<string, number> = {};
      await Promise.all(
        picker.map(async ({ workspace }) => {
          try {
            const stats = await api.flashcard.getStats(workspace.id);
            counts[workspace.id] = stats.total_cards;
          } catch {
            counts[workspace.id] = 0;
          }
        }),
      );
      if (active) {
        setCardCounts(counts);
      }
    }
    void loadCounts();
    return () => {
      active = false;
    };
  }, [picker]);

  const totalCards = picker.reduce((total, entry) => total + (cardCounts[entry.workspace.id] ?? 0), 0);

  async function exportDeck(ids: string[]) {
    if (ids.length === 0) { return; }

    setError(null);
    setExporting(true);
    try {
      const deckJson = await api.export.feedDeck(ids);
      const single = ids.length === 1 ? workspaces.find((w) => w.id === ids[0]) : null;
      const baseName = single ? sanitizeFilenamePart(single.name) : "aetherium";
      const timestamp = timestampForFilename(new Date());
      const destination = await save({
        title: "Save Boom Scroll deck",
        defaultPath: `${baseName}-boomscroll-${timestamp}.json`,
        filters: [{ name: "Boom Scroll Deck", extensions: ["json"] }],
      });
      if (!destination) { return; }

      await writeTextFile(destination, deckJson);
      setPickerOpen(false);
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
      {error && !pickerOpen && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Smartphone size={16} className="text-[var(--accent-color)]" />
                <h2 className="text-sm font-medium text-[var(--text-primary)]">Boom Scroll Deck</h2>
              </div>
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                Export flashcards as a deck file for the Boom Scroll mobile companion app.
                Everything stays local — transfer the file to your phone yourself.
              </p>
              <p className="mt-3 text-xs text-[var(--text-muted)]">
                {picker.length > 0
                  ? `${totalCards} card${totalCards === 1 ? "" : "s"} across ${picker.length} workspace${picker.length === 1 ? "" : "s"}.`
                  : "No workspaces available to export."}
              </p>
            </div>

            <button
              onClick={() => {
                setError(null);
                setPickerOpen(true);
              }}
              disabled={exporting || picker.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-color)] px-3 py-2 text-xs text-white hover:opacity-90 disabled:opacity-40"
            >
              {exporting ? <RefreshCw size={12} className="animate-spin" /> : <Smartphone size={12} />}
              {exporting ? "Exporting..." : "Export"}
            </button>
          </div>
        </section>
      </div>

      {pickerOpen && (
        <BoomScrollExportDialog
          entries={picker}
          cardCounts={cardCounts}
          busy={exporting}
          error={error}
          onCancel={() => {
            setPickerOpen(false);
            setError(null);
          }}
          onExport={(ids) => void exportDeck(ids)}
        />
      )}

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
