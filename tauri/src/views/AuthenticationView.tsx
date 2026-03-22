import React, { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { api } from "../lib/api";
import WindowControls, { onDragRegionMouseDown } from "../components/WindowControls";

interface Props {
  onAuthenticated: () => void;
}

export default function AuthenticationView({ onAuthenticated }: Props) {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pinEnabled, setPinEnabled] = useState(false);

  useEffect(() => {
    api.security.getStatus().then((status) => {
      setPinEnabled(status.pin_enabled);
    }).catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!secret.trim()) {
      setError(pinEnabled ? "Enter your PIN to continue." : "Please enter your password.");
      return;
    }

    if (pinEnabled) {
      setLoading(true);
      try {
        const verified = await api.security.verifyPin(secret);
        if (verified) {
          onAuthenticated();
        } else {
          setError("Incorrect PIN.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Incorrect PIN.");
      } finally {
        setLoading(false);
      }
      return;
    }

    // Touch ID remains a placeholder until native biometric auth is wired in.
    if (secret.trim()) {
      onAuthenticated();
    } else {
      setError("Please enter your password.");
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-[var(--bg-primary)]">
      <div data-tauri-drag-region onMouseDown={onDragRegionMouseDown} className="fixed top-0 left-0 right-0 h-9 z-50 flex items-center justify-end pr-2">
        <WindowControls />
      </div>
      <form
        onSubmit={handleSubmit}
        className="w-80 flex flex-col items-center gap-6"
      >
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-12 rounded-2xl bg-[var(--accent-color)]/20 flex items-center justify-center">
            <Lock size={22} className="text-[var(--accent-color)]" />
          </div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">Aetherium Locked</h1>
          <p className="text-xs text-[var(--text-muted)]">
            {pinEnabled ? "Enter your PIN passcode to continue." : "Enter your password to continue."}
          </p>
        </div>

        <input
          type="password"
          inputMode={pinEnabled ? "numeric" : undefined}
          autoComplete={pinEnabled ? "one-time-code" : "current-password"}
          value={secret}
          onChange={(e) => { setSecret(e.target.value); setError(""); }}
          placeholder={pinEnabled ? "PIN passcode" : "Password"}
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
      </form>
    </div>
  );
}
