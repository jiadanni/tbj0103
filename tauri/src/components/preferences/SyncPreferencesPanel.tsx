import { RefreshCw } from "lucide-react";
import { Toggle } from "../Toggle";
import type { AppSettings, GitSyncStatus } from "../../lib/api";

interface SyncPreferencesPanelProps {
  dbSettings: AppSettings;
  gitSync: GitSyncStatus | null;
  gitSyncUrl: string;
  gitSyncing: boolean;
  gitSyncSaving: boolean;
  isGitSyncSshUrl: boolean;
  onGitSyncUrlChange: (value: string) => void;
  onSyncIntervalChange: (value: number) => void;
  onToggleEnabled: () => void;
  onSaveRemoteUrl: () => void;
  onTriggerSync: () => void;
}

export function SyncPreferencesPanel({
  dbSettings,
  gitSync,
  gitSyncUrl,
  gitSyncing,
  gitSyncSaving,
  isGitSyncSshUrl,
  onGitSyncUrlChange,
  onSyncIntervalChange,
  onToggleEnabled,
  onSaveRemoteUrl,
  onTriggerSync,
}: SyncPreferencesPanelProps) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-4xl px-5 py-4 space-y-8">
          <section className="space-y-3" data-pref-section>
            <div className="pb-1.5 border-b border-[var(--border-color)]">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Multi-device Sync</h3>
              <p className="text-xs text-[var(--text-muted)]/80 mt-1">
                Sync your chat export files across devices using a private Git remote.
                Requires a private repository (GitHub, GitLab, or any SSH-accessible bare repo) and
                Git installed on this machine.
              </p>
              <p className="text-xs text-amber-400 mt-2" role="note">
                Only chat JSON exports are synced. Databases, settings, browser profiles, cookies,
                keys, and logs are excluded. Chats can still contain sensitive content; use a
                private repository.
              </p>
              <p className="text-xs text-amber-400 mt-2" role="note">
                Previously enabled Git sync? Existing local and remote Git history may contain
                browser sessions or secrets. Untracking files does not erase that history, and
                changing the remote URL can upload it again. History is never rewritten automatically.
                Disable sync until you have safely retired the old sync repository and created a
                fresh local repository with a new empty remote. Revoke exposed sessions and credentials.
              </p>
            </div>

            <div className="flex items-center justify-between py-1 border-t border-[var(--border-color)] pt-4">
              <div>
                <p className="text-sm font-semibold text-[var(--text-secondary)]">Enable sync</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Automatically sync in the background</p>
              </div>
              <Toggle on={gitSync?.enabled ?? false} onToggle={onToggleEnabled} />
            </div>

            <div className={`flex items-center justify-between py-1 ${gitSync?.enabled ? "" : "opacity-50"}`}>
              <div>
                <p className="text-sm text-[var(--text-secondary)]">Sync every (minutes)</p>
                {!gitSync?.enabled && (
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Enable sync above to change this</p>
                )}
              </div>
              <input
                type="number"
                min={1}
                max={60}
                disabled={!gitSync?.enabled}
                value={dbSettings.git_sync_interval_minutes}
                onChange={(e) => onSyncIntervalChange(Math.max(1, Math.min(60, Number(e.target.value) || 5)))}
                className="w-16 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-1 text-center text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)] disabled:cursor-not-allowed"
              />
            </div>

            <div className="border-t border-[var(--border-color)] pt-4 space-y-2">
              <label className="text-xs text-[var(--text-secondary)] block font-medium">Remote URL</label>
              <div className="flex gap-2">
                <input
                  value={gitSyncUrl}
                  onChange={(e) => onGitSyncUrlChange(e.target.value)}
                  placeholder="git@github.com:you/aetherium-sync.git"
                  className="flex-1 px-3 py-1.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)] font-mono"
                />
                <button
                  disabled={gitSyncSaving || !gitSyncUrl.trim() || !isGitSyncSshUrl}
                  onClick={onSaveRemoteUrl}
                  className="px-3 py-1.5 text-xs rounded bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-50"
                >
                  {gitSyncSaving ? <RefreshCw size={12} className="animate-spin" /> : "Save"}
                </button>
              </div>
              <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
                SSH remote required. Use `git@...` or `ssh://...` and ensure your key is loaded in `ssh-agent`.
              </p>
              {gitSyncUrl.trim() && !isGitSyncSshUrl && (
                <p className="text-[11px] text-amber-400 mt-1">
                  Git sync only accepts SSH remotes.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between py-1 border-t border-[var(--border-color)] pt-4">
              <div>
                <p className="text-xs text-[var(--text-muted)]">Last synced</p>
                <p className="text-sm font-semibold text-[var(--text-secondary)] mt-0.5">
                  {gitSync?.last_synced_at ? new Date(gitSync.last_synced_at).toLocaleString() : "Never"}
                </p>
              </div>
              <button
                disabled={gitSyncing || !gitSync?.enabled}
                onClick={onTriggerSync}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                {gitSyncing ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                Sync Now
              </button>
            </div>

            {gitSync?.last_error && (
              <div className="px-3 py-2 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                {gitSync.last_error}
              </div>
            )}
          </section>
      </div>
    </div>
  );
}
