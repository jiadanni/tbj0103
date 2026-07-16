/**
 * BoomScrollExportSection — export the workspace's flashcards as a Boom Scroll deck file.
 */
import { useMemo, useState } from "react";
import { message, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { RefreshCw, Smartphone } from "lucide-react";
import { api } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import SuccessDialog from "../components/SuccessDialog";

function sanitizeFilenamePart(value: string) {
  return value
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "workspace";
}

export default function BoomScrollExportSection() {
  const { workspaces, activeWorkspaceId } = useWorkspaceStore();
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successDialog, setSuccessDialog] = useState<{ title: string; description: string } | null>(null);

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  );

  async function exportDeck() {
    if (!activeWorkspaceId || !activeWorkspace) {return;}

    setError(null);
    const destination = await save({
      title: "Save Boom Scroll deck",
      defaultPath: `${sanitizeFilenamePart(activeWorkspace.name)}-boomscroll.json`,
      filters: [{ name: "Boom Scroll Deck", extensions: ["json"] }],
    });
    if (!destination) {return;}

    setExporting(true);
    try {
      const deckJson = await api.export.feedDeck(activeWorkspaceId);
      await writeTextFile(destination, deckJson);
      setSuccessDialog({
        title: "Deck exported",
        description: `Saved a Boom Scroll deck for "${activeWorkspace.name}". Move the file to your phone and open it in the Boom Scroll app.`,
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
              {"Export this workspace's flashcards as a deck file for the Boom Scroll mobile companion app."}
              {" Everything stays local — transfer the file to your phone yourself."}
            </p>
            <p className="mt-3 text-xs text-[var(--text-muted)]">
              {activeWorkspace
                ? `Current workspace: ${activeWorkspace.name}`
                : "Select a workspace to export a deck."}
            </p>
          </div>

          <button
            onClick={() => void exportDeck()}
            disabled={exporting || !activeWorkspace}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-color)] px-3 py-2 text-xs text-white hover:opacity-90 disabled:opacity-40"
          >
            {exporting ? <RefreshCw size={12} className="animate-spin" /> : <Smartphone size={12} />}
            {exporting ? "Exporting..." : "Export"}
          </button>
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
