import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BackgroundTaskEvent,
  BackgroundTaskPromptEvent,
  PerformanceStats,
} from "@/lib/api";
import { useChatStore } from "@/stores/chatStore";

const { getPerformanceStats, listenBackgroundTask, listenBackgroundTaskPrompt } =
  vi.hoisted(() => ({
    getPerformanceStats: vi.fn(),
    listenBackgroundTask: vi.fn(),
    listenBackgroundTaskPrompt: vi.fn(),
  }));
const { listWorkspaces, getPromptBankStatus } = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  getPromptBankStatus: vi.fn(),
}));
const { confirmBackgroundJob, dismissBackgroundJob, cancelBackgroundJob } =
  vi.hoisted(() => ({
    confirmBackgroundJob: vi.fn(),
    dismissBackgroundJob: vi.fn(),
    cancelBackgroundJob: vi.fn(),
  }));

vi.mock("@/lib/api", () => ({
  api: {
    system: {
      getPerformanceStats,
    },
    workspace: {
      list: listWorkspaces,
      getPromptBankStatus,
    },
    listenBackgroundTask,
    listenBackgroundTaskPrompt,
    backgroundJobs: {
      confirm: confirmBackgroundJob,
      dismiss: dismissBackgroundJob,
      cancel: cancelBackgroundJob,
    },
  },
}));

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
    useChatStore.setState(chatInitialState);
    getPerformanceStats.mockResolvedValue(emptyStats);
    listenBackgroundTask.mockReset();
    listenBackgroundTask.mockResolvedValue(() => {});
    listenBackgroundTaskPrompt.mockReset();
    listenBackgroundTaskPrompt.mockResolvedValue(() => {});
    confirmBackgroundJob.mockReset();
    confirmBackgroundJob.mockResolvedValue(true);
    dismissBackgroundJob.mockReset();
    dismissBackgroundJob.mockResolvedValue(true);
    cancelBackgroundJob.mockReset();
    cancelBackgroundJob.mockResolvedValue(true);
    listWorkspaces.mockReset();
    listWorkspaces.mockResolvedValue([]);
    getPromptBankStatus.mockReset();
    getPromptBankStatus.mockResolvedValue(null);
  });

  it("renders every active background job", async () => {
    let onTask: ((event: BackgroundTaskEvent) => void) | undefined;
    listenBackgroundTask.mockImplementation(async (callback: (event: BackgroundTaskEvent) => void) => {
      onTask = callback;
      return () => {};
    });

    render(<StatusBar />);

    await waitFor(() => expect(onTask).toBeDefined());

    act(() => {
      onTask?.(taskStarted("memory_extraction"));
      onTask?.(taskStarted("summarization"));
      onTask?.(taskStarted("flashcard_generation"));
      onTask?.(taskStarted("workspace_prompt_bank"));
    });

    expect(screen.getByText("Memory Extraction")).toBeInTheDocument();
    expect(screen.getByText("Summarization")).toBeInTheDocument();
    expect(screen.getByText("Flashcard Generation")).toBeInTheDocument();
    expect(screen.getByText("Starter Prompts")).toBeInTheDocument();
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
    let onTask: ((event: BackgroundTaskEvent) => void) | undefined;
    listenBackgroundTask.mockImplementation(async (callback: (event: BackgroundTaskEvent) => void) => {
      onTask = callback;
      return () => {};
    });

    render(<StatusBar />);
    await waitFor(() => expect(onTask).toBeDefined());

    act(() => {
      onTask?.(taskStarted("memory_extraction", "llama3"));
    });

    const stopButton = screen.getByLabelText("Stop Memory Extraction");
    act(() => {
      stopButton.click();
    });
    expect(cancelBackgroundJob).toHaveBeenCalledWith("memory_extraction");
  });

  it("reconciles an active prompt-bank job that started before listening", async () => {
    listWorkspaces.mockResolvedValue([{ id: "ws-1" }]);
    getPromptBankStatus.mockResolvedValue({
      prompt_count: 70,
      active_job: {
        id: "job-1",
        workspace_id: "ws-1",
        status: "running",
        target_count: 120,
        generated_count: 70,
        model: "llama3",
        error: null,
        started_at: null,
        completed_at: null,
      },
      latest_job: null,
    });

    render(<StatusBar />);

    expect(await screen.findByText("Starter Prompts")).toBeInTheDocument();
    expect(screen.getByText("llama3")).toBeInTheDocument();
  });
});
