import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "@/App";
import { listen } from "@tauri-apps/api/event";

const mocks = vi.hoisted(() => {
  const settings = {
    theme: "system", accentColor: "", fontSize: 16,
    setFontSize: vi.fn(), setWebSessionPreserve: vi.fn(),
    setChatTitleAutoRefresh: vi.fn(), setChatTitleRefreshInterval: vi.fn(),
    setAboutYou: vi.fn(),
  };
  const workspaces = {
    setWorkspaces: vi.fn(), setFoldersForWorkspace: vi.fn(),
    activeWorkspaceId: null, primaryWorkspaceId: null, secondaryWorkspaceId: null,
    panes: { primary: { workspaceId: null }, secondary: { workspaceId: null } },
    splitMode: false, setActiveWorkspaceId: vi.fn(),
  };
  const jobs = { hydrate: vi.fn(async () => {}), applyEvent: vi.fn() };
  return {
    settings, workspaces, jobs,
    api: {
      boot: { checkState: vi.fn() },
      security: { isUnlocked: vi.fn(), unlockApp: vi.fn() },
      chat: { retryFileSync: vi.fn() },
      workspace: { list: vi.fn() },
      settings: { getCore: vi.fn(), getInference: vi.fn(), getAdvanced: vi.fn() },
      quickSearch: { markMainWindowReady: vi.fn(async () => {}) },
      listenBackgroundTask: vi.fn(async () => vi.fn()),
      listenBackgroundSchedulerPauseStatus: vi.fn(async () => vi.fn()),
      knowledge: { listenWorkspaceProgress: vi.fn(async () => vi.fn()) },
    },
  };
});
vi.mock("@/lib/api", () => ({ api: mocks.api }));
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: Object.assign(
    <T,>(selector: (state: typeof mocks.settings) => T) => selector(mocks.settings),
    { getState: () => mocks.settings },
  ),
}));
vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: Object.assign(
    <T,>(selector: (state: typeof mocks.workspaces) => T) => selector(mocks.workspaces),
    { getState: () => mocks.workspaces },
  ),
}));
vi.mock("@/stores/backgroundJobs", () => ({
  useBackgroundJobsStore: { getState: () => mocks.jobs, setState: vi.fn() },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => vi.fn()) }));
vi.mock("@/components/Layout", () => ({ default: () => <div>Private application</div> }));
vi.mock("@/components/ZoomIndicator", () => ({ default: () => null }));
vi.mock("@/views/AuthenticationView", () => ({
  default: ({ onAuthenticated }: { onAuthenticated: () => void }) => (
    <button onClick={onAuthenticated}>Authenticate</button>
  ),
}));
vi.mock("@/views/BootUnlockView", () => ({ default: () => <div>Encrypted boot</div> }));
vi.mock("@/hooks/useNavigationHistory", () => ({
  useNavigationHistory: () => ({ goBack: vi.fn(), goForward: vi.fn(), canGoBack: false, canGoForward: false }),
}));
vi.mock("@/hooks/useNavigationHotkeys", () => ({ useNavigationHotkeys: vi.fn() }));

describe("fail-closed application boot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.api.boot.checkState.mockReset().mockResolvedValue({ unlock_required: false, pending_action: "" });
    mocks.api.security.isUnlocked.mockReset().mockResolvedValue(false);
    mocks.api.chat.retryFileSync.mockReset().mockResolvedValue(undefined);
    mocks.api.workspace.list.mockReset().mockResolvedValue([{ id: "workspace-1" }]);
    mocks.api.settings.getCore.mockReset().mockResolvedValue({});
    mocks.api.settings.getInference.mockReset().mockResolvedValue({});
    mocks.api.settings.getAdvanced.mockReset().mockResolvedValue({});
  });

  it("does not fetch private workspace/settings data before authentication", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "Authenticate" });
    expect(mocks.api.workspace.list).not.toHaveBeenCalled();
    expect(mocks.api.settings.getCore).not.toHaveBeenCalled();
    expect(mocks.api.chat.retryFileSync).not.toHaveBeenCalled();
    expect(mocks.jobs.hydrate).not.toHaveBeenCalled();
    expect(mocks.api.listenBackgroundTask).not.toHaveBeenCalled();
    mocks.api.security.isUnlocked.mockResolvedValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Authenticate" }));
    await screen.findByText("Private application");
    expect(mocks.workspaces.setWorkspaces).toHaveBeenCalled();
    expect(mocks.api.chat.retryFileSync).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.jobs.hydrate).toHaveBeenCalledTimes(1));
  });

  it("never grants authentication after a failed boot probe", async () => {
    mocks.api.boot.checkState.mockRejectedValue(new Error("Probe failed"));
    render(<App />);
    await screen.findByRole("alert");
    expect(mocks.api.workspace.list).not.toHaveBeenCalled();
    expect(mocks.api.security.unlockApp).not.toHaveBeenCalled();
    expect(screen.queryByText("Private application")).not.toBeInTheDocument();
  });

  it("requires a working lock subscription before exposing data", async () => {
    vi.mocked(listen).mockRejectedValueOnce(new Error("Lock event permission denied"));
    mocks.api.security.isUnlocked.mockResolvedValue(true);
    render(<App />);
    await screen.findByRole("alert");
    expect(mocks.api.workspace.list).not.toHaveBeenCalled();
    expect(screen.queryByText("Private application")).not.toBeInTheDocument();
  });

  it("surfaces settings failures rather than bypassing authentication", async () => {
    mocks.api.security.isUnlocked.mockResolvedValue(true);
    mocks.api.settings.getCore.mockRejectedValue(new Error("Settings unavailable"));
    render(<App />);
    await screen.findByRole("alert");
    expect(mocks.api.security.unlockApp).not.toHaveBeenCalled();
    expect(screen.queryByText("Private application")).not.toBeInTheDocument();
  });

  it("gates encrypted cold boot before probing authenticated database state", async () => {
    mocks.api.boot.checkState.mockResolvedValue({ unlock_required: true, pending_action: "" });
    render(<App />);
    await screen.findByText("Encrypted boot");
    expect(mocks.api.security.isUnlocked).not.toHaveBeenCalled();
    expect(mocks.api.chat.retryFileSync).not.toHaveBeenCalled();
  });

  it("surfaces file synchronization failure without blocking authenticated boot", async () => {
    const failure = new Error("File synchronization unavailable");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.api.security.isUnlocked.mockResolvedValue(true);
    mocks.api.chat.retryFileSync.mockRejectedValue(failure);
    try {
      render(<App />);
      await screen.findByText("Private application");
      expect(errorLog).toHaveBeenCalledWith("Failed to retry pending chat file synchronization:", failure);
    } finally {
      errorLog.mockRestore();
    }
  });

  it("opens normally when the backend reports no lock or an existing unlock", async () => {
    mocks.api.security.isUnlocked.mockResolvedValue(true);
    render(<App />);
    await waitFor(() => expect(screen.getByText("Private application")).toBeInTheDocument());
  });
});
