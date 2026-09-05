import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SchedulerPauseButton from "../../components/titlebar/SchedulerPauseButton";
import { useBackgroundJobsStore } from "../../stores/backgroundJobs";
import { api } from "../../lib/api";
import { startBackgroundJobsLifecycle } from "../../lib/backgroundJobsLifecycle";

vi.mock("../../lib/api", () => ({
  api: {
    system: { listActiveBackgroundJobs: vi.fn() },
    backgroundJobs: { getPauseStatus: vi.fn(), pause: vi.fn(), resume: vi.fn() },
    listenBackgroundTask: vi.fn(),
    listenBackgroundSchedulerPauseStatus: vi.fn(),
    knowledge: { listenWorkspaceProgress: vi.fn() },
  },
}));
vi.mock("../../components/Tooltip", () => ({
  Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

const active = { is_paused: false, paused_until: null, paused_indefinitely: false };
const paused = { is_paused: true, paused_until: null, paused_indefinitely: true };
const lifecycles: Array<() => void> = [];

function openControls() {
  fireEvent.click(screen.getByLabelText("Scheduler Status and Controls"));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  useBackgroundJobsStore.setState({
    jobs: new Map(), lastErrors: new Map(), hydrated: true, hydrating: false,
    pauseStatus: active, pauseError: null, hydrationError: null, subscriptionError: null,
  });
  vi.mocked(api.backgroundJobs.pause).mockResolvedValue(undefined);
  vi.mocked(api.backgroundJobs.resume).mockResolvedValue(undefined);
  vi.mocked(api.backgroundJobs.getPauseStatus).mockResolvedValue(active);
  vi.mocked(api.system.listActiveBackgroundJobs).mockResolvedValue([]);
  vi.mocked(api.listenBackgroundTask).mockResolvedValue(vi.fn());
  vi.mocked(api.listenBackgroundSchedulerPauseStatus).mockResolvedValue(vi.fn());
  vi.mocked(api.knowledge.listenWorkspaceProgress).mockResolvedValue(vi.fn());
});

afterEach(() => {
  cleanup();
  lifecycles.splice(0).forEach((stop) => stop());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SchedulerPauseButton errors", () => {
  it("retains failed pause controls with a visible error and supports retry", async () => {
    vi.mocked(api.backgroundJobs.pause).mockRejectedValueOnce(new Error("Pause denied"));
    render(<SchedulerPauseButton />);
    openControls();
    fireEvent.click(screen.getByText("Pause Indefinitely"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Pause denied");
    expect(screen.getByLabelText("Scheduler error")).toBeInTheDocument();
    expect(screen.getByText("Scheduled Jobs")).toBeInTheDocument();
    vi.mocked(api.backgroundJobs.getPauseStatus).mockResolvedValue(paused);
    fireEvent.click(screen.getByText("Pause Indefinitely"));
    await waitFor(() => expect(screen.queryByText("Scheduled Jobs")).not.toBeInTheDocument());
    expect(useBackgroundJobsStore.getState().pauseStatus).toEqual(paused);
    expect(api.backgroundJobs.pause).toHaveBeenCalledTimes(2);
  });

  it("surfaces resume rejection without claiming jobs resumed", async () => {
    useBackgroundJobsStore.setState({ pauseStatus: paused });
    vi.mocked(api.backgroundJobs.resume).mockRejectedValueOnce(new Error("Resume denied"));
    render(<SchedulerPauseButton />);
    openControls();
    fireEvent.click(screen.getByText("Resume Jobs"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Resume denied");
    expect(useBackgroundJobsStore.getState().pauseStatus?.is_paused).toBe(true);
    expect(screen.getByText("Resume Jobs")).toBeInTheDocument();
  });

  it("exposes hydration failure and retries status without discarding a job error", async () => {
    useBackgroundJobsStore.setState({
      hydrationError: "Background snapshot unavailable",
      pauseStatus: null,
      lastErrors: new Map([["failed", { taskType: "failed", message: "Prior job failure", at: 0 }]]),
    });
    render(<SchedulerPauseButton />);
    expect(screen.getByLabelText("Scheduler error")).toBeInTheDocument();
    openControls();
    expect(screen.getByRole("alert")).toHaveTextContent("Background snapshot unavailable");
    fireEvent.click(screen.getByText("Retry status refresh"));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(api.system.listActiveBackgroundJobs).toHaveBeenCalledTimes(1);
    expect(useBackgroundJobsStore.getState().lastErrors.get("failed")?.message).toBe("Prior job failure");
  });

  it("does not treat a successful command followed by failed status refresh as success", async () => {
    vi.mocked(api.backgroundJobs.getPauseStatus).mockRejectedValueOnce(new Error("Status unavailable"));
    render(<SchedulerPauseButton />);
    openControls();
    fireEvent.click(screen.getByText("5 Minutes"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Status unavailable");
    expect(screen.getByText("Scheduled Jobs")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Retry status refresh"));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("disables repeated actions until the outstanding command completes", async () => {
    let resolve!: () => void;
    vi.mocked(api.backgroundJobs.pause).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    render(<SchedulerPauseButton />);
    openControls();
    fireEvent.click(screen.getByText("Pause Indefinitely"));
    expect(screen.getByText("Pause Indefinitely")).toBeDisabled();
    fireEvent.click(screen.getByText("Pause Indefinitely"));
    expect(api.backgroundJobs.pause).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(); });
    expect(screen.queryByText("Scheduled Jobs")).not.toBeInTheDocument();
  });

  it("uses countdown ticks only for local display, never backend polling after expiry", async () => {
    vi.useFakeTimers();
    useBackgroundJobsStore.setState({
      pauseStatus: { ...paused, paused_indefinitely: false, paused_until: new Date(Date.now() + 1000).toISOString() },
    });
    render(<SchedulerPauseButton />);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(api.backgroundJobs.getPauseStatus).not.toHaveBeenCalled();
    act(() => useBackgroundJobsStore.getState().applyPauseStatus(active));
    openControls();
    expect(screen.getByText("Status: Active & idle")).toBeInTheDocument();
  });

  it("reconnects failed subscriptions rather than merely clearing the error with a snapshot", async () => {
    vi.mocked(api.listenBackgroundTask).mockRejectedValueOnce(new Error("Listener unavailable"));
    render(<SchedulerPauseButton />);
    act(() => { lifecycles.push(startBackgroundJobsLifecycle(true)); });
    openControls();
    expect(await screen.findByRole("alert")).toHaveTextContent("Listener unavailable");
    fireEvent.click(screen.getByText("Reconnect background updates"));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(api.listenBackgroundTask).toHaveBeenCalledTimes(2);
    act(() => {
      vi.mocked(api.listenBackgroundTask).mock.calls[1][0]({
        task_type: "after-retry", status: "started", workspace_id: "ws-1", message: "Received",
      });
    });
    expect(screen.getByText("Status: Active & processing")).toBeInTheDocument();
    act(() => { vi.mocked(api.listenBackgroundSchedulerPauseStatus).mock.calls[1][0](paused); });
    expect(screen.getByText("Status: Frozen indefinitely")).toBeInTheDocument();
  });
});
