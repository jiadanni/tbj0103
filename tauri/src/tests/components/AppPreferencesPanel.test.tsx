import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const platformState = vi.hoisted(() => ({ isMac: false, isLinux: true }));

vi.mock("@/lib/platform", () => ({
  get isMac() { return platformState.isMac; },
  get isLinux() { return platformState.isLinux; },
  isWindows: false,
  MOD_KEY: "Ctrl",
  CTRL_KEY: "Ctrl",
  isEditableElement: () => false,
}));

import { AppPreferencesPanel } from "@/components/preferences/AppPreferencesPanel";

describe("AppPreferencesPanel", () => {
  const defaultProps = {
    startAtLogin: false,
    openInBackground: false,
    keepRunningInTray: false,
    hideNativeMenu: false,
    onToggleStartAtLogin: vi.fn(),
    onToggleOpenInBackground: vi.fn(),
    onToggleKeepRunningInTray: vi.fn(),
    onToggleHideNativeMenu: vi.fn(),
    singleWindowMode: false,
    onToggleSingleWindowMode: vi.fn(),
    isDemoMode: false,
    onExitDemo: vi.fn(),
    onStartDemo: vi.fn(),
    quickSearchShortcutDraft: "",
    onQuickSearchShortcutDraftChange: vi.fn(),
    onCommitQuickSearchShortcut: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    platformState.isMac = false;
    platformState.isLinux = true;
  });

  it("hides 'Hide native menu' on Linux", () => {
    platformState.isMac = false;
    platformState.isLinux = true;

    render(<AppPreferencesPanel {...defaultProps} />);

    expect(screen.queryByText("Hide native menu")).toBeNull();
    expect(screen.queryByText(/Removes the standard application menu bar/)).toBeNull();
  });

  it("renders 'Hide native menu' on macOS and allows toggling it", () => {
    platformState.isMac = true;
    platformState.isLinux = false;

    render(<AppPreferencesPanel {...defaultProps} />);

    const label = screen.getByText("Hide native menu");
    expect(label).toBeInTheDocument();
    expect(screen.getByText(/Removes the standard application menu bar \(macOS only\)\./)).toBeInTheDocument();

    const row = label.closest(".flex");
    const button = row?.querySelector("button");
    expect(button).toBeTruthy();
    fireEvent.click(button as HTMLButtonElement);

    expect(defaultProps.onToggleHideNativeMenu).toHaveBeenCalledTimes(1);
  });

  it("constrains shortcut recorder width and renders shortcut badges", () => {
    render(
      <AppPreferencesPanel
        {...defaultProps}
        quickSearchShortcutDraft="Ctrl+Shift+K"
      />,
    );

    const ctrlBadge = screen.getByText("Ctrl");
    expect(ctrlBadge).toBeInTheDocument();
    expect(screen.getByText("Shift")).toBeInTheDocument();
    expect(screen.getByText("K")).toBeInTheDocument();

    const recorderContainer = ctrlBadge.closest(".flex.items-center.gap-2");
    expect(recorderContainer).toHaveClass("max-w-sm");
  });
});

