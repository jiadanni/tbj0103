import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/**
 * Behavioural regression coverage for window dragging by the titlebar.
 *
 * Layout.test.tsx mocks WindowControls wholesale, so it can only assert on
 * markup. This suite keeps the *real* `onDragRegionMouseDown` and stubs only
 * `startDragging`, so it verifies the thing users actually care about: does
 * pressing the empty part of the titlebar start a window drag?
 *
 * The bug this guards against: the workspace tab strip container is `flex-1`,
 * so tagging it `data-no-drag` silently made the entire titlebar area right of
 * the tabs inert, because the handler bails on any `[data-no-drag]` ancestor.
 */

const startDragging = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging,
    isMaximized: vi.fn(() => Promise.resolve(false)),
    maximize: vi.fn(() => Promise.resolve()),
    unmaximize: vi.fn(() => Promise.resolve()),
    minimize: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    setFocus: vi.fn(() => Promise.resolve()),
    onResized: vi.fn(() => Promise.resolve(() => {})),
    startResizeDragging: vi.fn(),
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(),
  ask: vi.fn(),
  message: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("react-resizable-panels", () => ({
  PanelGroup: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  Panel: ({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) => <div className={className} data-testid={id ? `panel-${id}` : undefined}>{children}</div>,
  PanelResizeHandle: ({ className }: { className?: string }) => <div data-testid="resize-handle" className={className} />,
}));

vi.mock("@/components/Sidebar", () => ({ default: () => <div>Sidebar</div> }));
vi.mock("@/components/CommandPalette", () => ({ default: () => null }));
vi.mock("@/hooks/useHotkeys", () => ({ useHotkeys: () => undefined }));

vi.mock("@/views/ChatView", () => ({ default: () => <div>Chat View</div> }));
vi.mock("@/views/KnowledgeGraphView", () => ({ default: () => <div>Graph View</div> }));
vi.mock("@/views/DailyNotesView", () => ({ default: () => <div>Daily Notes View</div> }));
vi.mock("@/views/FlashcardReviewView", () => ({ default: () => <div>Flashcards View</div> }));
vi.mock("@/views/FolderDashboardView", () => ({ default: () => <div>Project Dashboard</div> }));
vi.mock("@/views/PracticeView", () => ({ default: () => <div>Practice View</div> }));
vi.mock("@/views/PreferencesView", () => ({ default: () => <div>Preferences View</div> }));

import Layout from "@/components/Layout";

describe("titlebar drag region", () => {
  beforeEach(() => {
    startDragging.mockClear();
    useWorkspaceStore.setState({ workspaceNavigation: "top-tabs" });
  });

  function renderLayout() {
    return render(
      <MemoryRouter initialEntries={["/folder"]}>
        <Layout />
      </MemoryRouter>
    );
  }

  it("starts a window drag when the empty titlebar area is pressed", () => {
    renderLayout();

    const dragRegion = document.querySelector("[data-tauri-drag-region]");
    expect(dragRegion).not.toBeNull();

    fireEvent.mouseDown(dragRegion as Element, { button: 0 });

    expect(startDragging).toHaveBeenCalledTimes(1);
  });

  it("starts a window drag when the tab strip's empty space is pressed", () => {
    // The `flex-1` strip container fills the titlebar width remaining after the
    // tabs, so pressing it is what a user hits when grabbing "empty" titlebar.
    renderLayout();

    const tabStrip = document.querySelector("[data-workspace-tab-strip]");
    expect(tabStrip).not.toBeNull();

    fireEvent.mouseDown(tabStrip as Element, { button: 0 });

    expect(startDragging).toHaveBeenCalledTimes(1);
  });

  it("does not start a drag when a titlebar button is pressed", () => {
    renderLayout();

    const dragRegion = document.querySelector("[data-tauri-drag-region]");
    const button = dragRegion?.querySelector("button");
    expect(button).toBeTruthy();

    fireEvent.mouseDown(button as Element, { button: 0 });

    expect(startDragging).not.toHaveBeenCalled();
  });

  it("does not start a drag on non-left-click", () => {
    renderLayout();

    const dragRegion = document.querySelector("[data-tauri-drag-region]");

    fireEvent.mouseDown(dragRegion as Element, { button: 2 });

    expect(startDragging).not.toHaveBeenCalled();
  });
});
