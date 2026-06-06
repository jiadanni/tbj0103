/**
 * BootUnlockView — shown when the SQLite DB is encrypted and the pool has
 * NOT yet been opened. The user must supply their PIN; the backend unwraps
 * the DEK, processes any pending encrypt/decrypt action, and opens the
 * keyed pool. After success the parent re-mounts the main app.
 */
import React, { useState } from "react";
import { Database, Lock } from "lucide-react";
import { api, type BootStatus } from "../lib/api";
import WindowControls, { onDragRegionMouseDown, onDragRegionDoubleClick } from "../components/WindowControls";
import { isMac } from "../lib/platform";

interface Props {
  status: BootStatus;
  onUnlocked: () => void;
}

export default function BootUnlockView({ status, onUnlocked }: Props) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (pin.length < 4) {
      setError("Enter your PIN to continue.");
      return;
    }
    setBusy(true);
    try {
      await api.boot.unlock(pin);
      onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to unlock database.");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  const pendingLabel =
    status.pending_action === "encrypt"
      ? "Encrypting the database on this launch — this may take a moment."
      : status.pending_action === "decrypt"
        ? "Decrypting the database on this launch — this may take a moment."
        : null;

  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div
        data-tauri-drag-region
        onMouseDown={onDragRegionMouseDown}
        onDoubleClick={onDragRegionDoubleClick}
        className="h-9 w-full flex items-center justify-end px-2 select-none"
      >
        {!isMac && <WindowControls />}
      </div>
      <div className="flex-1 flex items-center justify-center px-6">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-sm flex flex-col gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-6 shadow-2xl"
        >
          <div className="flex flex-col items-center gap-1">
            <div className="w-10 h-10 rounded-xl bg-[var(--accent-color)]/20 flex items-center justify-center mb-1">
              <Database size={18} className="text-[var(--accent-color)]" />
            </div>
            <h2 className="text-base font-semibold">Unlock database</h2>
            <p className="text-xs text-[var(--text-muted)] text-center max-w-xs">
              Your database is encrypted. Enter your PIN to continue.
            </p>
          </div>

          {pendingLabel && (
            <p className="text-xs text-amber-400 text-center">{pendingLabel}</p>
          )}

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">PIN</label>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={pin}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 8)); setError(""); }}
              placeholder="4 to 8 digits"
              className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={busy || pin.length < 4}
            className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg bg-[var(--accent-color)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-60"
          >
            <Lock size={14} />
            {busy ? "Unlocking…" : "Unlock"}
          </button>
        </form>
      </div>
    </div>
  );
}
