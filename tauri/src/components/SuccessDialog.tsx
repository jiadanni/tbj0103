import React, { useEffect } from "react";
import { CheckCircle2 } from "lucide-react";

interface SuccessDialogProps {
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
}

export default function SuccessDialog({
  title,
  description,
  confirmLabel = "Done",
  onConfirm,
}: SuccessDialogProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" || event.key === "Enter") {
        onConfirm();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onConfirm]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-primary)]"
      onClick={onConfirm}
    >
      <div
        className="mx-4 flex w-full max-w-sm flex-col gap-5 rounded-3xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-6 shadow-2xl items-center text-center"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 size={24} />
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
            <p className="text-sm leading-6 text-[var(--text-secondary)]">{description}</p>
          </div>
        </div>
        <button
          onClick={onConfirm}
          className="w-full rounded-xl bg-[var(--accent-color)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
