import React, { useEffect, useState } from "react";
import { Fingerprint, Lock } from "lucide-react";
import { api } from "../lib/api";
import WindowControls, { onDragRegionMouseDown, onDragRegionDoubleClick } from "../components/WindowControls";
import { isMac } from "../lib/platform";

interface Props {
  onAuthenticated: () => void;
}

export default function AuthenticationView({ onAuthenticated }: Props) {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [touchIdLoading, setTouchIdLoading] = useState(false);
  const [touchIdEnabled, setTouchIdEnabled] = useState(false);
  const [pinLockEnabled, setPinLockEnabled] = useState(false);
  // When Touch ID is the primary method, PIN input is hidden until the user requests it
  const [showPinFallback, setShowPinFallback] = useState(false);

  useEffect(() => {
    api.security.getStatus().then((status) => {
      setTouchIdEnabled(status.touch_id_enabled);
      setPinLockEnabled(status.pin_lock_enabled);
      // If Touch ID is not the primary method, go straight to PIN
      if (!status.touch_id_enabled) { setShowPinFallback(true); }
    }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Unable to load security settings.");
    });
  }, [onAuthenticated]);

  async function handleTouchId() {
    setTouchIdLoading(true);
    setError("");
    try {
      const success = await api.security.authenticateBiometric();
      if (success) {
        onAuthenticated();
      } else {
        setError("Touch ID was not recognised. Try your PIN instead.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Touch ID failed. Try your PIN instead.");
    } finally {
      setTouchIdLoading(false);
    }
  }

  async function handlePinSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!secret.trim()) {
      setError("Enter your PIN to continue.");
      return;
    }

    setLoading(true);
    try {
      await api.security.unlockApp({ pin: secret });
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect PIN.");
    } finally {
      setLoading(false);
    }
  }

  const dragRegion = (
    <div
      data-tauri-drag-region
      onMouseDown={onDragRegionMouseDown}
      onDoubleClick={onDragRegionDoubleClick}
      className={`fixed top-0 left-0 right-0 h-9 z-50 flex items-center justify-end ${isMac ? "" : "pr-2"}`}
    >
      <WindowControls />
    </div>
  );

  // Touch ID screen — shown when Touch ID is active and the user hasn't asked for PIN
  if (touchIdEnabled && !showPinFallback) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg-primary)]">
        {dragRegion}
        <div className="w-80 flex flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-2">
            <div className="w-12 h-12 rounded-2xl bg-[var(--accent-color)]/20 flex items-center justify-center">
              <Fingerprint size={22} className="text-[var(--accent-color)]" />
            </div>
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">Aetherium Locked</h1>
            <p className="text-xs text-[var(--text-muted)]">Touch ID required to continue.</p>
          </div>

          <button
            onClick={handleTouchId}
            disabled={touchIdLoading}
            className="w-full py-2.5 rounded-lg bg-[var(--accent-color)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {touchIdLoading ? "Verifying…" : "Use Touch ID"}
          </button>

          {pinLockEnabled && (
            <button
              type="button"
              onClick={() => setShowPinFallback(true)}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              Use PIN instead
            </button>
          )}

          {error && (
            <p className="text-xs text-red-500 text-center">{error}</p>
          )}
        </div>
      </div>
    );
  }

  // PIN screen — primary or fallback
  return (
    <div className="flex h-screen items-center justify-center bg-[var(--bg-primary)]">
      {dragRegion}
      <form
        onSubmit={handlePinSubmit}
        className="w-80 flex flex-col items-center gap-6"
      >
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-12 rounded-2xl bg-[var(--accent-color)]/20 flex items-center justify-center">
            <Lock size={22} className="text-[var(--accent-color)]" />
          </div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">Aetherium Locked</h1>
          <p className="text-xs text-[var(--text-muted)]">
            {showPinFallback && touchIdEnabled ? "Enter your PIN passcode to continue." : "Enter your PIN passcode to continue."}
          </p>
        </div>

        <input
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={secret}
          onChange={(e) => { setSecret(e.target.value); setError(""); }}
          placeholder="PIN passcode"
          autoFocus
          className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
        />

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-lg bg-[var(--accent-color)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {loading ? "Unlocking..." : "Unlock"}
        </button>

        {showPinFallback && touchIdEnabled && (
          <button
            type="button"
            onClick={() => setShowPinFallback(false)}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            Use Touch ID instead
          </button>
        )}
      </form>
    </div>
  );
}
