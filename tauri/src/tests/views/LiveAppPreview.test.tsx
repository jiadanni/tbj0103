import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import LiveAppPreview from "@/views/preferences/LiveAppPreview";
import type { AppSettings } from "@/lib/api";

const platformState = vi.hoisted(() => ({ isMac: false }));

vi.mock("@/lib/platform", () => ({
  get isMac() { return platformState.isMac; },
  get isLinux() { return !platformState.isMac; },
  isWindows: false,
  MOD_KEY: "Ctrl",
  CTRL_KEY: "Ctrl",
  isEditableElement: () => false,
}));

vi.mock("@/lib/prefsWindowMode", () => ({
  usePrefsWindowMode: () => [false, vi.fn()],
}));

// The message thread is ChatView's concern; keep this test focused on chrome.
vi.mock("@/components/ChatMessageBubble", () => ({
  default: ({ msg }: { msg: { id: string } }) => <div data-testid={`bubble-${msg.id}`} />,
}));

const settingsStoreState = {
  chatMessageStyle: "bubble" as const,
  composerMode: "family" as const,
  codeBlockContainerStyle: "rounded" as const,
  codeBlockColorPalette: "balanced" as const,
  codeBlockKeywordColor: "preset" as const,
  showGenInfo: true,
  showGenInfoTokenCount: true,
  showGenInfoDuration: true,
  showGenInfoSpeed: true,
  showGenInfoModel: true,
  showStatusBar: true,
  showComposerWorkspaceSuggestions: true,
  showComposerChatFollowUps: true,
};

const workspaceStoreState = {
  workspaceNavigation: "top-tabs" as const,
  sectionNavigation: "sidebar" as const,
  subWorkspaceNavigation: "top-tabs" as const,
  combineWorkspaceDropdown: false,
  combineSubWorkspaceDropdown: false,
  combineSectionDropdown: false,
  workspaceSortOrder: "custom" as const,
};

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: <T,>(selector: (state: typeof settingsStoreState) => T) => selector(settingsStoreState),
}));

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: <T,>(selector: (state: typeof workspaceStoreState) => T) => selector(workspaceStoreState),
}));

const baseSettings = {
  theme: "dark",
  accent_color: "#007AFF",
  font_size: 16,
  hide_native_menu: false,
  menubar_icon_style: "monochrome",
  background_inference_enabled: true,
  memory_enabled: true,
} as unknown as AppSettings;

function renderPreview(overrides: Partial<AppSettings> = {}) {
  return render(<LiveAppPreview dbSettings={{ ...baseSettings, ...overrides }} />);
}

afterEach(() => {
  platformState.isMac = false;
});

describe("LiveAppPreview", () => {
  it("mirrors the real status bar: Jobs on the left, Zoom/CPU/RAM/VRAM meters on the right", () => {
    renderPreview();

    expect(screen.getByText("Jobs")).toBeInTheDocument();
    expect(screen.getByText("Zoom:")).toBeInTheDocument();
    expect(screen.getByText("CPU:")).toBeInTheDocument();
    expect(screen.getByText("RAM:")).toBeInTheDocument();
    expect(screen.getByText("VRAM:")).toBeInTheDocument();
    // Old drifted labels must be gone.
    expect(screen.queryByText(/Running Summaries/)).toBeNull();
    expect(screen.queryByText(/Idle \(Paused\)/)).toBeNull();
  });

  it("shows a running-job pill only while background inference is enabled", () => {
    const { unmount } = renderPreview({ background_inference_enabled: true } as Partial<AppSettings>);
    expect(screen.getByText("Summaries")).toBeInTheDocument();
    unmount();

    renderPreview({ background_inference_enabled: false } as Partial<AppSettings>);
    expect(screen.queryByText("Summaries")).toBeNull();
  });

  it("mirrors the real sidebar footer: Collapse, Preferences, and the Aetherium menu", () => {
    renderPreview();

    const sidebar = screen.getByTestId("sidebar");
    expect(sidebar).toHaveTextContent("Collapse");
    expect(sidebar).toHaveTextContent("Preferences");
    expect(sidebar).toHaveTextContent("Aetherium");
  });

  it("hides the macOS menubar mock on non-Mac platforms", () => {
    renderPreview();
    // "File" only appears in the menubar's app menu.
    expect(screen.queryByText("File")).toBeNull();
  });

  it("renders the macOS menubar mock on macOS", () => {
    platformState.isMac = true;
    renderPreview();
    expect(screen.getByText("File")).toBeInTheDocument();
    expect(screen.getByText("Workspace")).toBeInTheDocument();
  });
});
