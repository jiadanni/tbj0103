import React, { useState } from "react";
import { Lock } from "lucide-react";

interface Props {
  onAuthenticated: () => void;
}

export default function AuthenticationView({ onAuthenticated }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // In a real integration this would call security manager.
    // For now, any non-empty password or Touch ID dismisses the lock screen.
    if (password.trim()) {
      onAuthenticated();
    } else {
      setError("Please enter your password.");
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-[var(--bg-primary)]">
      <div data-tauri-drag-region className="fixed top-0 left-0 right-0 h-9 z-50" />
      <form
        onSubmit={handleSubmit}
        className="w-80 flex flex-col items-center gap-6"
      >
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-12 rounded-2xl bg-[var(--accent-color)]/20 flex items-center justify-center">
            <Lock size={22} className="text-[var(--accent-color)]" />
          </div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">Aetherium Locked</h1>
          <p className="text-xs text-[var(--text-muted)]">Enter your password to continue.</p>
        </div>

        <input
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(""); }}
          placeholder="Password"
          className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
        />

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          className="w-full py-2.5 rounded-lg bg-[var(--accent-color)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Unlock
        </button>
      </form>
    </div>
  );
}
