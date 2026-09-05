import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SyncPreferencesPanel } from "../../components/preferences/SyncPreferencesPanel";
import type { AppSettings } from "../../lib/api";

describe("SyncPreferencesPanel", () => {
  it("explains the chat-only boundary and retained sensitive Git history", () => {
    render(
      <SyncPreferencesPanel
        dbSettings={{ git_sync_interval_minutes: 5 } as AppSettings}
        gitSync={null}
        gitSyncUrl=""
        gitSyncing={false}
        gitSyncSaving={false}
        isGitSyncSshUrl={false}
        onGitSyncUrlChange={vi.fn()}
        onSyncIntervalChange={vi.fn()}
        onToggleEnabled={vi.fn()}
        onSaveRemoteUrl={vi.fn()}
        onTriggerSync={vi.fn()}
      />,
    );

    expect(screen.getByText(/Only chat JSON exports are synced/)).toHaveTextContent(
      /browser profiles, cookies, keys, and logs are excluded/,
    );
    const warning = screen.getByText(/Previously enabled Git sync/);
    expect(warning).toHaveTextContent(/changing the remote URL can upload it again/);
    expect(warning).toHaveTextContent(/History is never rewritten automatically/);
    expect(warning).toHaveTextContent(/Revoke exposed sessions and credentials/);
  });
});
