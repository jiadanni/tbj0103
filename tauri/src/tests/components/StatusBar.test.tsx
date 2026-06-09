import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BackgroundTaskEvent,
  BackgroundTaskPromptEvent,
  PerformanceStats,
  InferenceJobStatus,
} from "@/lib/api";
import { useChatStore } from "@/stores/chatStore";
import { useBackgroundJobsStore } from "@/stores/backgroundJobs";

const { getPerformanceStats, listenBackgroundTask, listenBackgroundTaskPrompt, listenWorkspaceProgress, listActiveBackgroundJobs } =
  vi.hoisted(() => ({
    getPerformanceStats: vi.fn(),
    listenBackgroundTask: vi.fn(),
    listenBackgroundTaskPrompt: vi.fn(),
    listenWorkspaceProgress: vi.fn(),
    listActiveBackgroundJobs: vi.fn(),
  }));
const { listWorkspaces, getPromptBankStatus } = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  getPromptBankStatus: vi.fn(),
}));
const { confirmBackgroundJob, dismissBackgroundJob, cancelBackgroundJob, getInferenceJobStatuses } =
  vi.hoisted(() => ({
    confirmBackgroundJob: vi.fn(),
    dismissBackgroundJob: vi.fn(),
    cancelBackgroundJob: vi.fn(),
    getInferenceJobStatuses: vi.fn(),
  }));

vi.mock("@/lib/api", () => ({
  api: {
    system: {
      getPerformanceStats,
      listActiveBackgroundJobs,
    },
    workspace: {
      list: listWorkspaces,
      getPromptBankStatus,
    },
    knowledge: {
      listenWorkspaceProgress,
    },
    listenBackgroundTask,
    listenBackgroundTaskPrompt,
    backgroundJobs: {
      confirm: confirmBackgroundJob,
      dismiss: dismissBackgroundJob,
      cancel: cancelBackgroundJob,
      getInferenceJobStatuses,
    },
  },
}));

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import StatusBar from "@/components/StatusBar";

const emptyStats: PerformanceStats = {
  cpu_usage_percent: 0,
  memory_used_bytes: 0,
  memory_total_bytes: 1,
  gpu_vram_used_bytes: null,
  gpu_vram_total_bytes: null,
  gpu_name: null,
  gpu_vram_usage_available: false,
  cpu_core_usages: [],
};

const chatInitialState = {
  activeChatId: null,
  sessions: [],
  messages: {},
  streamingSessionId: null,
  streamingContent: "",
  refiningSessionId: null,
  refineContent: "",
};

function setVisibilityState(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
}

function taskStarted(taskType: string, model?: string): BackgroundTaskEvent {
  return {
    task_type: taskType,
    status: "started",
    message: `${taskType} started`,
    model,
  };
}


describe("StatusBar", () => {
  beforeEach(() => {
    setVisibilityState("visible");
    useChatStore.setState(chatInitialState);
    getPerformanceStats.mockResolvedValue(emptyStats);
    listenBackgroundTask.mockReset();
    listenBackgroundTask.mockResolvedValue(() => {});
    listenBackgroundTaskPrompt.mockReset();
    listenBackgroundTaskPrompt.mockResolvedValue(() => {});
    listenWorkspaceProgress.mockReset();
    listenWorkspaceProgress.mockResolvedValue(() => {});
    confirmBackgroundJob.mockReset();
    confirmBackgroundJob.mockResolvedValue(true);
    dismissBackgroundJob.mockReset();
    dismissBackgroundJob.mockResolvedValue(true);
    cancelBackgroundJob.mockReset();
    cancelBackgroundJob.mockResolvedValue(true);
    getInferenceJobStatuses.mockReset();
    getInferenceJobStatuses.mockResolvedValue([]);
    listWorkspaces.mockReset();
    listWorkspaces.mockResolvedValue([]);
    getPromptBankStatus.mockReset();
    getPromptBankStatus.mockResolvedValue(null);
    listActiveBackgroundJobs.mockReset();
    listActiveBackgroundJobs.mockResolvedValue([]);
    useBackgroundJobsStore.setState({
      jobs: new Map(),
      hydrated: false,
    });
  });

  it("still samples performance stats when the document reports hidden", async () => {
    setVisibilityState("hidden");

    render(<StatusBar />);

    await waitFor(() => expect(getPerformanceStats).toHaveBeenCalledTimes(1));
    expect(listWorkspaces).not.toHaveBeenCalled();
  });

  it("starts a fresh performance sample after a StrictMode remount", async () => {
    getPerformanceStats.mockImplementation(() => new Promise(() => {}));

    render(
      <React.StrictMode>
        <StatusBar />
      </React.StrictMode>,
    );

    await waitFor(() => expect(getPerformanceStats.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("renders every active background job", async () => {
    render(<StatusBar />);

    act(() => {
      useBackgroundJobsStore.getState().applyEvent(taskStarted("memory_extraction"));
      useBackgroundJobsStore.getState().applyEvent(taskStarted("summarization"));
      useBackgroundJobsStore.getState().applyEvent(taskStarted("flashcard_generation"));
      useBackgroundJobsStore.getState().applyEvent(taskStarted("workspace_prompt_bank"));
    });

    expect(screen.getByText("Memory Extraction")).toBeInTheDocument();
    expect(screen.getByText("Summarization")).toBeInTheDocument();
    expect(screen.getByText("Flashcard Generation")).toBeInTheDocument();
    expect(screen.getByText("Starter Prompts")).toBeInTheDocument();
  });

  it("shows workspace analysis activity in the status bar", async () => {
    render(<StatusBar />);

    act(() => {
      useBackgroundJobsStore.getState().applyEvent({
        task_type: "workspace_analysis",
        status: "started",
        message: "Chunk 1/3",
        model: "llama3",
      });
    });

    expect(screen.getByText("Workspace Analysis")).toBeInTheDocument();
    expect(screen.getByText("Chunk 1/3")).toBeInTheDocument();
    expect(screen.getByText("llama3")).toBeInTheDocument();
  });

  it("renders queued jobs separately from running jobs", async () => {
    render(<StatusBar />);

    act(() => {
      useBackgroundJobsStore.getState().applyEvent({
        task_type: "workspace_glossary",
        status: "queued",
        message: "Queued for glossary refresh…",
        model: "gemma3:1b",
      });
      useBackgroundJobsStore.getState().applyEvent(taskStarted("memory_extraction", "llama3"));
    });

    expect(screen.getByText("Memory Extraction")).toBeInTheDocument();
    expect(screen.getByText("Glossary Refresh")).toBeInTheDocument();
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.queryByLabelText("Stop Glossary Refresh")).not.toBeInTheDocument();
  });

  it("shows a read-only scheduled jobs popover", async () => {
    const statuses: InferenceJobStatus[] = [
      {
        job_key: "memory_extraction",
        label: "Memory Extraction",
        enabled: true,
        state: "scheduled",
        run_mode: "auto",
        due_label: "checks every minute when idle",
      },
    ];
    getInferenceJobStatuses.mockResolvedValue(statuses);

    render(<StatusBar />);

    act(() => {
      screen.getByRole("button", { name: "Show scheduled jobs" }).click();
    });

    expect(await screen.findByRole("dialog", { name: "Scheduled jobs" })).toBeInTheDocument();
    expect(screen.getByText("Memory Extraction")).toBeInTheDocument();
    expect(screen.getByText("checks every minute when idle")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /run next/i })).not.toBeInTheDocument();

    const configureBtn = screen.getByRole("button", { name: "Configure Jobs →" });
    expect(configureBtn).toBeInTheDocument();
    
    act(() => {
      configureBtn.click();
    });

    expect(mockNavigate).toHaveBeenCalledWith("/preferences", {
      state: { settingsTab: "inference-jobs" },
    });
  });

  it("shows a play-button prompt when a job requests confirmation and confirms on click", async () => {
    let onPrompt: ((event: BackgroundTaskPromptEvent) => void) | undefined;
    listenBackgroundTaskPrompt.mockImplementation(
      async (callback: (event: BackgroundTaskPromptEvent) => void) => {
        onPrompt = callback;
        return () => {};
      },
    );

    render(<StatusBar />);
    await waitFor(() => expect(onPrompt).toBeDefined());

    act(() => {
      onPrompt?.({
        task_type: "concept_hierarchy",
        mode: "dual_model",
        status: "pending",
        heavy_model: "llama3.1:70b",
        small_model: "llama3.1:8b",
        timeout_seconds: 20,
      });
    });

    const playButton = await screen.findByLabelText(
      /Run Topic Linking now with llama3\.1:70b/,
    );
    expect(playButton).toBeInTheDocument();
    expect(screen.getByText("llama3.1:70b")).toBeInTheDocument();

    act(() => {
      playButton.click();
    });

    expect(confirmBackgroundJob).toHaveBeenCalledWith("concept_hierarchy");
    await waitFor(() =>
      expect(screen.queryByLabelText(/Run Topic Linking now/)).not.toBeInTheDocument(),
    );
  });

  it("clears the prompt when the backend signals dismissal", async () => {
    let onPrompt: ((event: BackgroundTaskPromptEvent) => void) | undefined;
    listenBackgroundTaskPrompt.mockImplementation(
      async (callback: (event: BackgroundTaskPromptEvent) => void) => {
        onPrompt = callback;
        return () => {};
      },
    );

    render(<StatusBar />);
    await waitFor(() => expect(onPrompt).toBeDefined());

    act(() => {
      onPrompt?.({
        task_type: "summarization",
        mode: "confirm_only",
        status: "pending",
        heavy_model: "llama3.1:70b",
        small_model: undefined,
        timeout_seconds: 20,
      });
    });
    expect(screen.getByText("Summarization")).toBeInTheDocument();

    act(() => {
      onPrompt?.({
        task_type: "summarization",
        mode: "confirm_only",
        status: "dismissed",
        heavy_model: undefined,
        small_model: undefined,
        timeout_seconds: 20,
      });
    });
    await waitFor(() =>
      expect(screen.queryByLabelText(/Run Summarization now/)).not.toBeInTheDocument(),
    );
  });

  it("calls cancel_background_job when the stop button on a running job is clicked", async () => {
    render(<StatusBar />);

    act(() => {
      useBackgroundJobsStore.getState().applyEvent(taskStarted("memory_extraction", "llama3"));
    });

    const stopButton = screen.getByLabelText("Stop Memory Extraction");
    act(() => {
      stopButton.click();
    });
    expect(cancelBackgroundJob).toHaveBeenCalledWith("memory_extraction");
  });

  it("reconciles an active prompt-bank job that started before listening", async () => {
    act(() => {
      useBackgroundJobsStore.setState({
        jobs: new Map([
          [
            "workspace_prompt_bank",
            {
              task_type: "workspace_prompt_bank",
              workspace_id: "ws-1",
              status: "running",
              model: "llama3",
            },
          ],
        ]),
      });
    });

    render(<StatusBar />);

    expect(await screen.findByText("Starter Prompts")).toBeInTheDocument();
    expect(screen.getByText("llama3")).toBeInTheDocument();
  });

  it("does not show prompt-bank as a second active job while workspace analysis is running", async () => {
    act(() => {
      useBackgroundJobsStore.setState({
        jobs: new Map([
          [
            "workspace_prompt_bank",
            {
              task_type: "workspace_prompt_bank",
              workspace_id: "ws-1",
              status: "running",
              model: "llama3",
            },
          ],
        ]),
      });
    });

    render(<StatusBar />);

    expect(screen.getByText("Starter Prompts")).toBeInTheDocument();

    act(() => {
      useBackgroundJobsStore.getState().applyEvent({
        task_type: "workspace_prompt_bank",
        status: "failed",
        message: "",
      });
      useBackgroundJobsStore.getState().applyEvent({
        task_type: "workspace_analysis",
        status: "started",
        message: "Chunk 1/3",
        model: "llama3",
      });
    });

    expect(await screen.findByText("Workspace Analysis")).toBeInTheDocument();
    expect(screen.queryByText("Starter Prompts")).not.toBeInTheDocument();
  });

  it("does not show glossary refresh as a second active job while workspace analysis is running", async () => {
    render(<StatusBar />);

    act(() => {
      useBackgroundJobsStore.getState().applyEvent(taskStarted("workspace_glossary", "gemma3:1b"));
      useBackgroundJobsStore.getState().applyEvent({
        task_type: "workspace_analysis",
        status: "started",
        message: "Batch 1/1 · message…",
        model: "llama3",
      });
    });

    expect(await screen.findByText("Workspace Analysis")).toBeInTheDocument();
    expect(screen.queryByText("Glossary Refresh")).not.toBeInTheDocument();
  });
});
