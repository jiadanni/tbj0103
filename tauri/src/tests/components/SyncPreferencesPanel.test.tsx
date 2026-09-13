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

  it("renders device identity and sync role when enabled", () => {
    render(
      <SyncPreferencesPanel
        dbSettings={{ git_sync_interval_minutes: 5 } as AppSettings}
        gitSync={{
          enabled: true,
          remote_url: "git@github.com:user/repo.git",
          last_synced_at: "2026-09-13T10:00:00Z",
          last_error: "",
          device_id: "test-device-uuid",
          device_label: "My MacBook",
          device_branch: "device/test-device-uuid",
          main_branch: "main",
          is_main_role: false,
        }}
        gitSyncUrl="git@github.com:user/repo.git"
        gitSyncing={false}
        gitSyncSaving={false}
        isGitSyncSshUrl={true}
        onGitSyncUrlChange={vi.fn()}
        onSyncIntervalChange={vi.fn()}
        onToggleEnabled={vi.fn()}
        onSaveRemoteUrl={vi.fn()}
        onTriggerSync={vi.fn()}
      />,
    );

    expect(screen.getByText("This Device")).toBeInTheDocument();
    expect(screen.getByText("device/test-device-uuid")).toBeInTheDocument();
    expect(screen.getByText("Main Branch Role")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Make this device main/i })).toBeInTheDocument();
    expect(screen.getByText("Other Devices")).toBeInTheDocument();
  });
});
