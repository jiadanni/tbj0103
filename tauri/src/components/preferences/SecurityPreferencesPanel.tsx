import { useState } from "react";
import { Lock } from "lucide-react";
import { Toggle } from "../Toggle";
import { api, type AppSettings, type SecurityStatus } from "../../lib/api";

type DbEncryptionStatus = { configured: boolean; pending_restart: boolean; pending_action: string } | null;

interface SecurityPreferencesPanelProps {
  dbSettings: AppSettings;
  onSet: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onPatchDbSettings: (patch: Partial<AppSettings>) => void;
  securityStatus: SecurityStatus | null;
  onSecurityStatusChange: (status: SecurityStatus) => void;
  dbEncryptionStatus: DbEncryptionStatus;
  onDbEncryptionStatusChange: (status: DbEncryptionStatus) => void;
}

export function SecurityPreferencesPanel({
  dbSettings,
  onSet,
  onPatchDbSettings,
  securityStatus,
  onSecurityStatusChange,
  dbEncryptionStatus,
  onDbEncryptionStatusChange,
}: SecurityPreferencesPanelProps) {
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinSaving, setPinSaving] = useState(false);
  const [pinMessage, setPinMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showPinSetupModal, setShowPinSetupModal] = useState(false);
  const [encryptionPin, setEncryptionPin] = useState("");
  const [encryptionMessage, setEncryptionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [encryptionBusy, setEncryptionBusy] = useState(false);

  const pinConfigured = securityStatus?.pin_enabled ?? false;
  const biometricAvailable = securityStatus?.biometric_available ?? false;
  const biometricLabel = securityStatus?.biometric_label ?? "Biometric authentication";

  function resetPinForm() {
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
  }

  async function handleSetPin() {
    const hadConfiguredPin = securityStatus?.pin_enabled ?? false;
    setPinMessage(null);

    if (!/^\d{4,8}$/.test(newPin)) {
      setPinMessage({ type: "error", text: "PIN must be 4 to 8 digits." });
      return;
    }

    if (newPin !== confirmPin) {
      setPinMessage({ type: "error", text: "New PIN and confirmation do not match." });
      return;
    }

    if (hadConfiguredPin && !/^\d{4,8}$/.test(currentPin)) {
      setPinMessage({ type: "error", text: "Enter your current PIN to change it." });
      return;
    }

    setPinSaving(true);
    try {
      await api.security.setPin(newPin, hadConfiguredPin ? currentPin : undefined);
      const refreshedStatus = await api.security.getStatus();
      onSecurityStatusChange(refreshedStatus);
      resetPinForm();
      setPinMessage({
        type: "success",
        text: hadConfiguredPin
          ? "PIN updated."
          : dbSettings.pin_lock_enabled
            ? "PIN saved."
            : "PIN saved. Enable app lock to require it on launch.",
      });
    } catch (err) {
      setPinMessage({ type: "error", text: err instanceof Error ? err.message : "Unable to save PIN." });
    } finally {
      setPinSaving(false);
    }
  }

  async function handleSetPinFromModal() {
    setPinMessage(null);

    if (!/^\d{4,8}$/.test(newPin)) {
      setPinMessage({ type: "error", text: "PIN must be 4 to 8 digits." });
      return;
    }
    if (newPin !== confirmPin) {
      setPinMessage({ type: "error", text: "PINs do not match." });
      return;
    }

    setPinSaving(true);
    try {
      await api.security.setPin(newPin, undefined);
      const refreshedStatus = await api.security.getStatus();
      onSecurityStatusChange(refreshedStatus);
      onSet("pin_lock_enabled", true);
      resetPinForm();
      setPinMessage(null);
      setShowPinSetupModal(false);
    } catch (err) {
      setPinMessage({ type: "error", text: err instanceof Error ? err.message : "Unable to save PIN." });
    } finally {
      setPinSaving(false);
    }
  }

  async function handleRemovePin() {
    setPinMessage(null);
    if (!/^\d{4,8}$/.test(currentPin)) {
      setPinMessage({ type: "error", text: "Enter your current PIN to remove it." });
      return;
    }

    setPinSaving(true);
    try {
      await api.security.removePin(currentPin);
      const refreshedStatus = await api.security.getStatus();
      onSecurityStatusChange(refreshedStatus);
      onPatchDbSettings({ pin_lock_enabled: false, touch_id_enabled: false });
      resetPinForm();
      setPinMessage({ type: "success", text: "PIN removed." });
    } catch (err) {
      setPinMessage({ type: "error", text: err instanceof Error ? err.message : "Unable to remove PIN." });
    } finally {
      setPinSaving(false);
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-4xl px-5 py-4 space-y-8">
          <>
            <div className="flex flex-col gap-8">
            {/* Left Column: Enable & Unlock Options */}
            <div className="space-y-8">
              {/* ── Require PIN on launch ── */}
              <section className="space-y-3" data-pref-section>
                <div className="pb-1.5 border-b border-[var(--border-color)]">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">App lock</h3>
                </div>
                <div className="flex items-start gap-3 py-0.5">
                  <Toggle
                    on={dbSettings.pin_lock_enabled}
                    onToggle={() => {
                    if (!dbSettings.pin_lock_enabled) {
                    // Enabling — if no PIN exists, show the setup modal
                    if (!pinConfigured) {
                    resetPinForm();
                    setPinMessage(null);
                    setShowPinSetupModal(true);
                    } else {
                    onSet("pin_lock_enabled", true);
                    }
                    } else {
                    // Disabling
                    onSet("pin_lock_enabled", false);
                    if (dbSettings.touch_id_enabled) {
                    onSet("touch_id_enabled", false);
                    }
                    }
                    }}
                    />
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">Require PIN on launch</p>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      {dbSettings.pin_lock_enabled
                        ? "The app will prompt for your PIN (or biometrics) at startup."
                        : "Lock the app with a PIN passcode each time it starts."}
                    </p>
                  </div>
                </div>

                {/* ── Biometric ── */}
                {dbSettings.pin_lock_enabled && biometricAvailable && (
                  <div className="flex items-start gap-3 py-0.5">
                    <Toggle
                      on={dbSettings.touch_id_enabled}
                      onToggle={() => onSet("touch_id_enabled", !dbSettings.touch_id_enabled)}
                      />
                    <div>
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{biometricLabel}</p>
                      <p className="text-xs text-[var(--text-muted)] mt-1">
                        Use {biometricLabel} as a quick unlock. PIN is always available as a fallback.
                      </p>
                    </div>
                  </div>
                )}

                {/* ── Strict auth for destructive ops ── */}
                {dbSettings.pin_lock_enabled && (
                  <div className="flex items-start gap-3 py-0.5">
                    <Toggle
                      on={dbSettings.strict_auth_mode}
                      onToggle={() => onSet("strict_auth_mode", !dbSettings.strict_auth_mode)}
                      />
                    <div>
                      <p className="text-sm font-semibold text-[var(--text-primary)]">Require auth for destructive actions</p>
                      <p className="text-xs text-[var(--text-muted)] mt-1">
                        When enabled, deleting items and importing data require authentication. Disabled by default.
                      </p>
                    </div>
                  </div>
                )}
              </section>

              {/* ── Auto-lock ── */}
              {dbSettings.pin_lock_enabled && (
                <section className="space-y-3" data-pref-section>
                  <div className="pb-1.5 border-b border-[var(--border-color)]">
                    <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Auto-lock</h3>
                    <p className="text-xs text-[var(--text-muted)]/80 mt-1">Automatically lock the app after a period of inactivity.</p>
                  </div>
                  <div className="flex flex-row flex-wrap gap-x-6 gap-y-2 pt-1 font-normal">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name="auto_lock"
                        checked={dbSettings.auto_lock_minutes === 0}
                        onChange={() => onSet("auto_lock_minutes", 0)}
                        className="accent-[var(--accent-color)]"
                      />
                      <span className="text-[var(--text-secondary)] font-normal">Off</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer whitespace-nowrap">
                      <input
                        type="radio"
                        name="auto_lock"
                        checked={dbSettings.auto_lock_minutes > 0}
                        onChange={() => onSet("auto_lock_minutes", dbSettings.auto_lock_minutes > 0 ? dbSettings.auto_lock_minutes : 5)}
                        className="accent-[var(--accent-color)]"
                      />
                      <span className="text-[var(--text-secondary)] font-normal">Lock after</span>
                      {dbSettings.auto_lock_minutes > 0 && (
                        <span className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            max={1440}
                            value={dbSettings.auto_lock_minutes}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              if (val > 0) { onSet("auto_lock_minutes", val); }
                            }}
                            className="w-20 px-2 py-1 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                          />
                          <span className="text-xs text-[var(--text-secondary)] font-normal">minutes</span>
                        </span>
                      )}
                    </label>
                  </div>
                </section>
              )}
            </div>

            {/* Right Column: PIN Management */}
            <div className="space-y-8">
              {dbSettings.pin_lock_enabled && (
                <section className="space-y-3" data-pref-section>
                  <div className="pb-1.5 border-b border-[var(--border-color)] flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">PIN passcode</h3>
                      <p className="text-xs text-[var(--text-muted)]/80 mt-1 max-w-sm">
                        4 to 8 digits. Stored as a hash, never plaintext.
                      </p>
                    </div>
                    <span className="text-[11px] px-2 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                      Active
                    </span>
                  </div>

                  <div>
                    <label className="text-xs text-[var(--text-secondary)] mb-1.5 block font-medium">Current PIN</label>
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={currentPin}
                      onChange={(e) => { setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 8)); setPinMessage(null); }}
                      placeholder="Current PIN"
                      className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-xs text-[var(--text-secondary)] mb-1.5 block font-medium">New PIN</label>
                      <input
                        type="password"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={newPin}
                        onChange={(e) => { setNewPin(e.target.value.replace(/\D/g, "").slice(0, 8)); setPinMessage(null); }}
                        placeholder="4 to 8 digits"
                        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--text-secondary)] mb-1.5 block font-medium">Confirm PIN</label>
                      <input
                        type="password"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={confirmPin}
                        onChange={(e) => { setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 8)); setPinMessage(null); }}
                        placeholder="Repeat PIN"
                        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                      />
                    </div>
                  </div>

                  {pinMessage && (
                    <p className={`text-xs ${pinMessage.type === "success" ? "text-emerald-400" : "text-red-400"}`}>
                      {pinMessage.text}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={handleSetPin}
                      disabled={pinSaving}
                      className="px-3.5 py-2 rounded-lg bg-[var(--accent-color)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-60"
                    >
                      {pinSaving ? "Saving..." : "Update PIN"}
                    </button>
                    <button
                      onClick={handleRemovePin}
                      disabled={pinSaving}
                      className="px-3.5 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-60"
                    >
                      Remove PIN
                    </button>
                  </div>
                </section>
              )}

              {/* ── Database encryption ── */}
              <section className="space-y-3" data-pref-section>
                <div className="pb-1.5 border-b border-[var(--border-color)] flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Database encryption</h3>
                    <p className="text-xs text-[var(--text-muted)]/80 mt-1 max-w-sm">
                      Encrypts the SQLite database file at rest with SQLCipher. The key is wrapped with your PIN — losing the PIN means losing the data.
                    </p>
                  </div>
                  {dbEncryptionStatus?.pending_restart ? (
                    <span className="text-[11px] px-2 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 whitespace-nowrap">
                      Restart pending
                    </span>
                  ) : dbEncryptionStatus?.configured ? (
                    <span className="text-[11px] px-2 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                      On
                    </span>
                  ) : (
                    <span className="text-[11px] px-2 py-1 rounded-full border border-[var(--border-color)] text-[var(--text-muted)]">
                      Off
                    </span>
                  )}
                </div>

                {!securityStatus?.pin_enabled && (
                  <p className="text-xs text-amber-400">
                    Set a PIN passcode first — database encryption is layered on top of it.
                  </p>
                )}

                {dbEncryptionStatus?.pending_restart && (
                  <p className="text-xs text-[var(--text-secondary)]">
                    A change to encrypt the database is staged. It will run on the next app launch. The pre-launch unlock UI is not yet shipped — for now, the app requires the <code>AETHERIUM_DB_PIN</code> environment variable to be set on startup, or you can cancel the pending action below.
                  </p>
                )}

                {securityStatus?.pin_enabled && (
                  <>
                    <div>
                      <label className="text-xs text-[var(--text-secondary)] mb-1.5 block font-medium">PIN</label>
                      <input
                        type="password"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={encryptionPin}
                        onChange={(e) => { setEncryptionPin(e.target.value.replace(/\D/g, "").slice(0, 8)); setEncryptionMessage(null); }}
                        placeholder="Confirm with PIN"
                        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                      />
                    </div>

                    {encryptionMessage && (
                      <p className={`text-xs ${encryptionMessage.type === "success" ? "text-emerald-400" : "text-red-400"}`}>
                        {encryptionMessage.text}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2 pt-1">
                      {!dbEncryptionStatus?.configured && !dbEncryptionStatus?.pending_restart && (
                        <button
                          disabled={encryptionBusy || encryptionPin.length < 4}
                          onClick={async () => {
                            setEncryptionBusy(true);
                            setEncryptionMessage(null);
                            try {
                              await api.security.enableDbEncryption(encryptionPin);
                              const refreshed = await api.security.getDbEncryptionStatus();
                              onDbEncryptionStatusChange(refreshed);
                              setEncryptionPin("");
                              setEncryptionMessage({ type: "success", text: "Encryption staged. It will run on the next app launch." });
                            } catch (err) {
                              setEncryptionMessage({ type: "error", text: err instanceof Error ? err.message : String(err) });
                            } finally {
                              setEncryptionBusy(false);
                            }
                          }}
                          className="px-3.5 py-2 rounded-lg bg-[var(--accent-color)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-60"
                        >
                          {encryptionBusy ? "Working..." : "Enable encryption"}
                        </button>
                      )}

                      {dbEncryptionStatus?.configured && !dbEncryptionStatus.pending_restart && (
                        <button
                          disabled={encryptionBusy || encryptionPin.length < 4}
                          onClick={async () => {
                            setEncryptionBusy(true);
                            setEncryptionMessage(null);
                            try {
                              await api.security.disableDbEncryption(encryptionPin);
                              const refreshed = await api.security.getDbEncryptionStatus();
                              onDbEncryptionStatusChange(refreshed);
                              setEncryptionPin("");
                              setEncryptionMessage({ type: "success", text: "Decryption staged. It will run on the next app launch." });
                            } catch (err) {
                              setEncryptionMessage({ type: "error", text: err instanceof Error ? err.message : String(err) });
                            } finally {
                              setEncryptionBusy(false);
                            }
                          }}
                          className="px-3.5 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-60"
                        >
                          {encryptionBusy ? "Working..." : "Disable encryption"}
                        </button>
                      )}

                      {dbEncryptionStatus?.pending_restart && (
                        <button
                          disabled={encryptionBusy || encryptionPin.length < 4}
                          onClick={async () => {
                            setEncryptionBusy(true);
                            setEncryptionMessage(null);
                            try {
                              await api.security.cancelPendingDbEncryption(encryptionPin);
                              const refreshed = await api.security.getDbEncryptionStatus();
                              onDbEncryptionStatusChange(refreshed);
                              setEncryptionPin("");
                              setEncryptionMessage({ type: "success", text: "Pending action cancelled." });
                            } catch (err) {
                              setEncryptionMessage({ type: "error", text: err instanceof Error ? err.message : String(err) });
                            } finally {
                              setEncryptionBusy(false);
                            }
                          }}
                          className="px-3.5 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-60"
                        >
                          {encryptionBusy ? "Working..." : "Cancel pending action"}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </section>
            </div>
          </div>

            {/* ── PIN Setup Modal ── */}
            {showPinSetupModal && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
                onClick={() => { setShowPinSetupModal(false); resetPinForm(); setPinMessage(null); }}
              >
                <div
                  className="mx-4 flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-6 shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-10 h-10 rounded-xl bg-[var(--accent-color)]/20 flex items-center justify-center mb-1">
                      <Lock size={18} className="text-[var(--accent-color)]" />
                    </div>
                    <h2 className="text-base font-semibold text-[var(--text-primary)]">Set a PIN</h2>
                    <p className="text-xs text-[var(--text-muted)] text-center">
                      Create a 4–8 digit PIN to lock the app on launch.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-[var(--text-secondary)] mb-1 block">PIN</label>
                      <input
                        type="password"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={newPin}
                        onChange={(e) => { setNewPin(e.target.value.replace(/\D/g, "").slice(0, 8)); setPinMessage(null); }}
                        placeholder="4 to 8 digits"
                        autoFocus
                        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--text-secondary)] mb-1 block">Confirm PIN</label>
                      <input
                        type="password"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={confirmPin}
                        onChange={(e) => { setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 8)); setPinMessage(null); }}
                        placeholder="Repeat PIN"
                        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                      />
                    </div>
                  </div>

                  {pinMessage && (
                    <p className={`text-xs ${pinMessage.type === "success" ? "text-emerald-400" : "text-red-400"}`}>
                      {pinMessage.text}
                    </p>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => { setShowPinSetupModal(false); resetPinForm(); setPinMessage(null); }}
                      disabled={pinSaving}
                      className="flex-1 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSetPinFromModal}
                      disabled={pinSaving}
                      className="flex-1 py-2 rounded-lg bg-[var(--accent-color)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-60"
                    >
                      {pinSaving ? "Saving..." : "Enable Lock"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
      </div>
    </div>
  );
}
