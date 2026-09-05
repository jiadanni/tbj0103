import React from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useScopedTopicSignature, useScopedWorkspace, WorkspacePaneProvider } from "../../lib/workspacePane";
import { useWorkspaceStore, type Folder, type Workspace } from "../../stores/workspaceStore";
import { useChatStore } from "../../stores/chatStore";

vi.mock("../../lib/api", () => ({
  api: { backgroundJobs: { setCurrentWorkspaceId: vi.fn().mockResolvedValue(undefined) } },
  registerIpcContextProvider: vi.fn(),
}));

function workspace(id: string, parent: string | null = null): Workspace {
  return {
    id, name: id, description: "", prompt_instructions: "", is_hidden: false,
    created_at: "", updated_at: "", parent_workspace_id: parent, icon: "",
    order_index: 0, last_message_at: null, survey_data: null, signature_updated_at: null,
    topic_signature: {
      auto_detected_tags: [], custom_tags: [id], excluded_tags: [], intent_patterns: [],
      generated_at: null, message_count_at_gen: null, ollama_enriched: false,
    },
  };
}

const folder: Folder = {
  id: "folder-1", workspace_id: "ws-1", name: "Folder", folder_description: "",
  custom_instructions: "", color: "", icon: "", created_at: "", updated_at: "",
};

beforeEach(() => {
  useWorkspaceStore.setState({
    ...useWorkspaceStore.getInitialState(),
    workspaces: [workspace("ws-1"), workspace("ws-2"), workspace("ws-3"), workspace("child", "ws-1")],
    activeWorkspaceId: "ws-1", activeParentWorkspaceId: "ws-1", activeFolderId: folder.id,
    folders: [folder], foldersByWorkspace: { "ws-1": [folder], "ws-2": [], "ws-3": [] },
    panes: {
      primary: { workspaceId: "ws-1", folderId: folder.id, chatSessionId: null, view: "chat", noteSelection: null },
      secondary: { workspaceId: "ws-2", folderId: null, chatSessionId: null, view: "chat", noteSelection: null },
    },
  });
  useChatStore.setState({ activeChatId: "single-chat" });
});

describe("pane isolation", () => {
  it("preserves explicit folder root and root workspace through enter/exit", () => {
    useWorkspaceStore.getState().enterSplitMode();
    useWorkspaceStore.getState().setPaneFolder("primary", null);
    const { result } = renderHook(() => useScopedWorkspace(), {
      wrapper: ({ children }) => <WorkspacePaneProvider paneId="primary">{children}</WorkspacePaneProvider>,
    });
    expect(result.current.activeFolderId).toBeNull();
    expect(useWorkspaceStore.getState().activeFolderId).toBe(folder.id);
    act(() => { useWorkspaceStore.getState().exitSplitMode(); });
    expect(useWorkspaceStore.getState().activeFolderId).toBeNull();
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-1");
    expect(useChatStore.getState().activeChatId).toBe("single-chat");
  });

  it("uses the selected workspace cache on exit, not the old window folder", () => {
    useWorkspaceStore.getState().enterSplitMode();
    useWorkspaceStore.getState().setPaneWorkspace("primary", "ws-2");
    useWorkspaceStore.getState().setPaneFolder("primary", folder.id);
    useWorkspaceStore.getState().exitSplitMode();
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-2");
    expect(useWorkspaceStore.getState().activeFolderId).toBeNull();
    expect(useWorkspaceStore.getState().folders).toEqual([]);
    expect(useChatStore.getState().activeChatId).toBeNull();
  });

  it("preserves a route-seeded chat and an existing third-workspace secondary pane", () => {
    useWorkspaceStore.getState().setPaneChatSession("primary", "route-chat");
    useWorkspaceStore.getState().setPaneWorkspace("secondary", "ws-3");
    useWorkspaceStore.getState().setPaneChatSession("secondary", "third-chat");
    useWorkspaceStore.getState().enterSplitMode();
    expect(useWorkspaceStore.getState().panes.primary.chatSessionId).toBe("route-chat");
    expect(useWorkspaceStore.getState().panes.secondary.workspaceId).toBe("ws-3");
    expect(useWorkspaceStore.getState().panes.secondary.chatSessionId).toBe("third-chat");
    useWorkspaceStore.getState().exitSplitMode();
    expect(useChatStore.getState().activeChatId).toBe("route-chat");
  });

  it("subscribes to topic signatures by each pane's workspace, including single pane", () => {
    const primary = renderHook(() => useScopedTopicSignature(), {
      wrapper: ({ children }) => <WorkspacePaneProvider paneId="primary">{children}</WorkspacePaneProvider>,
    });
    const secondary = renderHook(() => useScopedTopicSignature(), {
      wrapper: ({ children }) => <WorkspacePaneProvider paneId="secondary">{children}</WorkspacePaneProvider>,
    });
    const single = renderHook(() => useScopedTopicSignature());
    expect(primary.result.current?.custom_tags).toEqual(["ws-1"]);
    expect(secondary.result.current?.custom_tags).toEqual(["ws-2"]);
    expect(single.result.current?.custom_tags).toEqual(["ws-1"]);
    const signature = { ...workspace("ws-2").topic_signature, custom_tags: ["Updated"] };
    act(() => { useWorkspaceStore.getState().setWorkspaceTopicSignature("ws-2", signature); });
    expect(secondary.result.current).toBe(signature);
    expect(primary.result.current?.custom_tags).toEqual(["ws-1"]);
    act(() => { useWorkspaceStore.getState().setActiveTopicSignature(signature); });
    expect(single.result.current?.custom_tags).toEqual(["ws-1"]);
  });
});
