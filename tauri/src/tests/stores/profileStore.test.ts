import { describe, it, expect, beforeEach, vi } from "vitest";
import { useProfileStore } from "../../stores/profileStore";
import { api, type AppProfile, type ProfilesResponse } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  api: {
    profile: {
      list: vi.fn(),
      create: vi.fn(),
      switch: vi.fn(),
      rename: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

const mockDefaultProfile: AppProfile = {
  id: "default",
  name: "Default",
  description: "Primary workspace vault",
  created_at: "2026-01-01T00:00:00Z",
  is_default: true,
};

const mockClaudeProfile: AppProfile = {
  id: "claude-archive",
  name: "Claude Archive",
  description: "Historical Claude export",
  created_at: "2026-09-20T12:00:00Z",
  is_default: false,
};

const mockResponse: ProfilesResponse = {
  active_profile_id: "default",
  active_profile: mockDefaultProfile,
  profiles: [mockDefaultProfile, mockClaudeProfile],
};

describe("profileStore", () => {
  beforeEach(() => {
    useProfileStore.setState({
      profiles: [],
      activeProfileId: "default",
      activeProfile: null,
      loading: false,
      error: null,
    });
    vi.resetAllMocks();
  });

  it("loads profiles successfully", async () => {
    vi.mocked(api.profile.list).mockResolvedValue(mockResponse);

    await useProfileStore.getState().loadProfiles();

    const state = useProfileStore.getState();
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.activeProfileId).toBe("default");
    expect(state.activeProfile).toEqual(mockDefaultProfile);
    expect(state.profiles).toHaveLength(2);
    expect(api.profile.list).toHaveBeenCalledTimes(1);
  });

  it("handles error during profile loading", async () => {
    vi.mocked(api.profile.list).mockRejectedValue(new Error("Failed to read profiles.json"));

    await useProfileStore.getState().loadProfiles();

    const state = useProfileStore.getState();
    expect(state.loading).toBe(false);
    expect(state.error).toBe("Failed to read profiles.json");
    expect(state.profiles).toHaveLength(0);
  });

  it("creates a new profile and reloads if switchTo is false", async () => {
    const newProfile: AppProfile = {
      id: "work-vault",
      name: "Work Vault",
      description: "Work chats only",
      created_at: "2026-09-20T14:00:00Z",
      is_default: false,
    };
    vi.mocked(api.profile.create).mockResolvedValue(newProfile);
    vi.mocked(api.profile.list).mockResolvedValue({
      active_profile_id: "default",
      active_profile: mockDefaultProfile,
      profiles: [mockDefaultProfile, mockClaudeProfile, newProfile],
    });

    const res = await useProfileStore.getState().createProfile("Work Vault", "Work chats only", false);

    expect(res).toEqual(newProfile);
    expect(api.profile.create).toHaveBeenCalledWith("Work Vault", "Work chats only", false);
    expect(api.profile.list).toHaveBeenCalled();
  });

  it("switches profile", async () => {
    vi.mocked(api.profile.switch).mockResolvedValue(undefined);

    await useProfileStore.getState().switchProfile("claude-archive");

    expect(api.profile.switch).toHaveBeenCalledWith("claude-archive");
  });

  it("renames a profile", async () => {
    const updated: AppProfile = {
      ...mockClaudeProfile,
      name: "Claude Archive 2026",
    };
    vi.mocked(api.profile.rename).mockResolvedValue(updated);
    vi.mocked(api.profile.list).mockResolvedValue({
      active_profile_id: "default",
      active_profile: mockDefaultProfile,
      profiles: [mockDefaultProfile, updated],
    });

    const res = await useProfileStore.getState().renameProfile("claude-archive", "Claude Archive 2026");

    expect(res.name).toBe("Claude Archive 2026");
    expect(api.profile.rename).toHaveBeenCalledWith("claude-archive", "Claude Archive 2026", undefined);
    expect(api.profile.list).toHaveBeenCalled();
  });

  it("deletes a profile", async () => {
    vi.mocked(api.profile.delete).mockResolvedValue(undefined);
    vi.mocked(api.profile.list).mockResolvedValue({
      active_profile_id: "default",
      active_profile: mockDefaultProfile,
      profiles: [mockDefaultProfile],
    });

    await useProfileStore.getState().deleteProfile("claude-archive");

    expect(api.profile.delete).toHaveBeenCalledWith("claude-archive");
    expect(api.profile.list).toHaveBeenCalled();
  });
});
