import { useEffect, useState } from "react";
import { FileText, BookOpen, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { api, type ProjectNote, type Source } from "../lib/api";
import type { ChatSession } from "../stores/chatStore";

export type ConvertKind = "note" | "document";

interface ConvertChatModalProps {
  session: ChatSession;
  kind: ConvertKind;
  ollamaUrl?: string;
  onClose: () => void;
  onSuccess: (kind: ConvertKind, result: ProjectNote | Source) => void;
}

type Phase =
  | { status: "idle" }
  | { status: "converting" }
  | { status: "done"; result: ProjectNote | Source }
  | { status: "error"; message: string };

export default function ConvertChatModal({
  session,
  kind,
  ollamaUrl,
  onClose,
  onSuccess,
}: ConvertChatModalProps) {
  const [phase, setPhase] = useState<Phase>({ status: "idle" });

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && phase.status !== "converting") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [phase.status, onClose]);

  async function runConvert() {
    setPhase({ status: "converting" });
    try {
      const result =
        kind === "note"
          ? await api.chat.convertToNote(session.id, ollamaUrl || undefined)
          : await api.chat.convertToDocument(session.id, ollamaUrl || undefined);
      setPhase({ status: "done", result });
      onSuccess(kind, result);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string" && err.trim()
            ? err
            : `Failed to convert chat to ${kind}.`;
      setPhase({ status: "error", message });
    }
  }

  const targetLabel = kind === "note" ? "note" : "document";
  const Icon = kind === "note" ? FileText : BookOpen;
  const busy = phase.status === "converting";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="mx-4 flex w-full max-w-md flex-col gap-5 rounded-3xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-color)]/12 text-[var(--accent-color)]">
            <Icon size={18} />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <h3 className="text-base font-semibold text-[var(--text-primary)]">
              Convert chat to {targetLabel}
            </h3>
            <p className="text-sm leading-6 text-[var(--text-secondary)]">
              Summarize <span className="font-medium text-[var(--text-primary)]">{session.title || "Untitled chat"}</span>{" "}
              and save it as a {targetLabel} in this workspace. Key concepts will be linked into the knowledge graph.
            </p>
          </div>
        </div>

        {phase.status === "converting" && (
          <div className="flex items-center gap-2 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-subtle)] px-4 py-3 text-sm text-[var(--text-secondary)]">
            <Loader2 size={14} className="animate-spin" />
            <span>Summarizing and extracting concepts…</span>
          </div>
        )}

        {phase.status === "done" && (
          <div className="flex items-center gap-2 rounded-2xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-300">
            <CheckCircle2 size={14} />
            <span>{kind === "note" ? "Note" : "Document"} created.</span>
          </div>
        )}

        {phase.status === "error" && (
          <div className="flex items-start gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span className="leading-5">{phase.message}</span>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-xl border border-[var(--border-color)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase.status === "done" ? "Close" : "Cancel"}
          </button>
          {phase.status !== "done" && (
            <button
              onClick={runConvert}
              disabled={busy}
              className="rounded-xl bg-[var(--accent-color)] px-4 py-2 text-sm text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase.status === "error" ? "Retry" : `Convert to ${targetLabel}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
