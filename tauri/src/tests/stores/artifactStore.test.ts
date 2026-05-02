import { describe, it, expect, beforeEach, vi } from "vitest";
import { useArtifactStore } from "../../stores/artifactStore";
import { api } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  api: {
    artifact: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const INITIAL = {
  artifacts: [],
  activeArtifact: null,
  isPanelOpen: false,
  isLoading: false,
};

describe("artifactStore", () => {
  beforeEach(() => {
    useArtifactStore.setState(INITIAL);
    vi.clearAllMocks();
  });

  it("loads artifacts", async () => {
    const mockSummaries = [
      { id: "a-1", title: "Artifact 1", artifact_type: "code" }
    ];
    vi.mocked(api.artifact.list).mockResolvedValue(mockSummaries as unknown as never[]);

    await useArtifactStore.getState().loadArtifacts("ws-1");

    expect(useArtifactStore.getState().artifacts).toEqual(mockSummaries);
    expect(useArtifactStore.getState().isLoading).toBe(false);
  });

  it("creates an artifact", async () => {
    const mockArtifact = {
      id: "a-2",
      title: "New Art",
      artifact_type: "code",
      language: "ts",
      description: "desc",
      tags: "[\"tag1\"]",
      is_pinned: false,
      version: 1,
      updated_at: new Date().toISOString(),
    };
    vi.mocked(api.artifact.create).mockResolvedValue(mockArtifact as unknown as never);

    await useArtifactStore.getState().createArtifact({
      workspace_id: "ws-1",
      title: "New Art",
      artifact_type: "code",
      language: "ts", description: "desc", content: "const x = 1;",
    });

    const state = useArtifactStore.getState();
    expect(state.artifacts.length).toBe(1);
    expect(state.artifacts[0].id).toBe("a-2");
    expect(state.artifacts[0].tags).toEqual(["tag1"]);
    expect(state.activeArtifact).toEqual(mockArtifact);
    expect(state.isPanelOpen).toBe(true);
  });

  it("deletes an artifact", async () => {
    useArtifactStore.setState({
      artifacts: [{ id: "a-1", title: "A1", artifact_type: "code" }] as unknown as never[],
      activeArtifact: { id: "a-1" } as unknown as never,
    });

    await useArtifactStore.getState().deleteArtifact("a-1");

    expect(api.artifact.delete).toHaveBeenCalledWith("a-1");
    expect(useArtifactStore.getState().artifacts).toEqual([]);
    expect(useArtifactStore.getState().activeArtifact).toBeNull();
  });
});
