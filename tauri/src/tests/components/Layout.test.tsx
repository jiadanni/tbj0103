import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useWorkspaceStore } from "@/stores/workspaceStore";

vi.mock("react-resizable-panels", () => ({
  PanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelResizeHandle: () => <div data-testid="resize-handle" />,
}));

vi.mock("@/components/Sidebar", () => ({
  default: () => <div>Sidebar</div>,
}));

vi.mock("@/components/CommandPalette", () => ({
  default: () => null,
}));

vi.mock("@/components/ArtifactPanel", () => ({
  default: () => null,
}));

vi.mock("@/components/WindowControls", () => ({
  __esModule: true,
  default: () => null,
  onDragRegionDoubleClick: vi.fn(),
  onDragRegionMouseDown: vi.fn(),
}));

vi.mock("@/hooks/useHotkeys", () => ({
  useHotkeys: () => undefined,
}));

vi.mock("@/lib/workspacePane", () => ({
  WorkspacePaneProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useScopedWorkspace: () => ({
    activeWorkspaceId: "ws-1",
    activeProjectId: null,
    activeView: "project",
    activeChatSessionId: null,
    noteSelection: null,
    isSplitPane: true,
  }),
}));

vi.mock("@/views/ChatView", () => ({ default: () => <div>Chat View</div> }));
vi.mock("@/views/MemoryView", () => ({ default: () => <div>Memory View</div> }));
vi.mock("@/views/KnowledgeGraphView", () => ({ default: () => <div>Graph View</div> }));
vi.mock("@/views/FlashcardReviewView", () => ({ default: () => <div>Flashcards View</div> }));
vi.mock("@/views/ProjectDashboardView", () => ({ default: () => <div>Project Dashboard</div> }));
vi.mock("@/views/SettingsView", () => ({ default: () => <div>Settings View</div> }));
vi.mock("@/views/NoteEditorView", () => ({ default: () => <div>Notes View</div> }));
vi.mock("@/views/SourceBrowserView", () => ({ default: () => <div>Sources View</div> }));
vi.mock("@/views/ThoughtQueueView", () => ({ default: () => <div>Thoughts View</div> }));
vi.mock("@/views/RecycleBinView", () => ({ default: () => <div>Recycle Bin View</div> }));

import Layout from "@/components/Layout";

const INITIAL = {
  workspaces: [],
  activeWorkspaceId: null,
  activeProjectId: null,
  projects: [],
  isDemoMode: false,
  workspaceNavigation: "sidebar" as const,
  sectionNavigation: "sidebar" as const,
  splitWorkspaceNavigation: "match-main" as const,
  splitSectionNavigation: "match-main" as const,
  activeTopicSignature: null,
  migrationSuggestion: null,
  projectsByWorkspace: {},
  splitMode: false,
  splitSizes: [50, 50] as [number, number],
  activePaneId: "primary" as const,
  panes: {
    primary: { workspaceId: null, projectId: null, view: "project" as const, chatSessionId: null, noteSelection: null },
    secondary: { workspaceId: null, projectId: null, view: "project" as const, chatSessionId: null, noteSelection: null },
  },
};

describe("Layout", () => {
  beforeEach(() => {
    useWorkspaceStore.setState(INITIAL);
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 });
  });

  it("exits split mode before opening settings from the global toolbar", () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Agentic", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, created_at: "", updated_at: "" },
        { id: "ws-2", name: "Rust", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, created_at: "", updated_at: "" },
      ],
      activeWorkspaceId: "ws-1",
      splitMode: true,
      panes: {
        primary: { workspaceId: "ws-1", projectId: null, view: "project", chatSessionId: null, noteSelection: null },
        secondary: { workspaceId: "ws-2", projectId: null, view: "chat", chatSessionId: null, noteSelection: null },
      },
    });

    render(
      <MemoryRouter initialEntries={["/project"]}>
        <Layout />
      </MemoryRouter>
    );

    fireEvent.click(screen.getAllByRole("button", { name: /settings/i })[0]);

    expect(useWorkspaceStore.getState().splitMode).toBe(false);
    expect(screen.getByText("Settings View")).toBeInTheDocument();
  });

  it("marks the top toolbar as a drag region", () => {
    render(
      <MemoryRouter initialEntries={["/project"]}>
        <Layout />
      </MemoryRouter>
    );

    const dragRegions = document.querySelectorAll("[data-tauri-drag-region]");
    expect(dragRegions.length).toBeGreaterThan(1);
  });

  it("keeps split mode active in a collapsed state when the window is narrow", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 640 });

    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws-1", name: "Agentic", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, created_at: "", updated_at: "" },
        { id: "ws-2", name: "Rust", description: "", prompt_instructions: "", topic_signature: { domain_tags: [], manual_tags: [], ignored_tags: [], intent_patterns: [], generated_at: null, message_count_at_gen: null, ollama_enriched: false }, signature_updated_at: null, created_at: "", updated_at: "" },
      ],
      activeWorkspaceId: "ws-1",
      splitMode: true,
      panes: {
        primary: { workspaceId: "ws-1", projectId: null, view: "project", chatSessionId: null, noteSelection: null },
        secondary: { workspaceId: "ws-2", projectId: null, view: "chat", chatSessionId: null, noteSelection: null },
      },
    });

    render(
      <MemoryRouter initialEntries={["/project"]}>
        <Layout />
      </MemoryRouter>
    );

    expect(useWorkspaceStore.getState().splitMode).toBe(true);
    expect(screen.getByLabelText("Second pane collapsed until the window is wider")).toBeInTheDocument();
  });
});
