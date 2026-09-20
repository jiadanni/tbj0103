import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ProfilesPreferencesPanel } from "../../components/preferences/ProfilesPreferencesPanel";
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
  name: "Default Vault",
  description: "Primary workspace",
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

const mockProfilesResponse: ProfilesResponse = {
  active_profile_id: "default",
  active_profile: mockDefaultProfile,
  profiles: [mockDefaultProfile, mockClaudeProfile],
};

describe("ProfilesPreferencesPanel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useProfileStore.setState({
      profiles: [mockDefaultProfile, mockClaudeProfile],
      activeProfileId: "default",
      activeProfile: mockDefaultProfile,
      loading: false,
      error: null,
    });
    vi.mocked(api.profile.list).mockResolvedValue(mockProfilesResponse);
  });

  it("renders active vault and available vaults", () => {
    render(<ProfilesPreferencesPanel />);

    expect(screen.getByText("Profiles & Vaults")).toBeInTheDocument();
    expect(screen.getByText("Active Vault")).toBeInTheDocument();
    expect(screen.getAllByText("Default Vault")).toHaveLength(2);
    expect(screen.getByText("Claude Archive")).toBeInTheDocument();
    expect(screen.getByText("Switch to Vault")).toBeInTheDocument();
  });

  it("opens create modal on New Vault click and cancels cleanly", async () => {
    render(<ProfilesPreferencesPanel />);

    fireEvent.click(screen.getByText("New Vault / Profile"));

    expect(screen.getByText("Create New Vault / Profile")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel"));

    await waitFor(() => {
      expect(screen.queryByText("Create New Vault / Profile")).not.toBeInTheDocument();
    });
  });

  it("opens switch confirmation modal when clicking Switch to Vault", () => {
    render(<ProfilesPreferencesPanel />);

    fireEvent.click(screen.getByText("Switch to Vault"));

    expect(screen.getByText("Switch to \"Claude Archive\"")).toBeInTheDocument();
    expect(screen.getByText("Switch & Restart")).toBeInTheDocument();
  });

  it("opens delete confirmation modal when clicking delete button", () => {
    render(<ProfilesPreferencesPanel />);

    const deleteBtn = screen.getByTitle("Delete Vault");
    fireEvent.click(deleteBtn);

    expect(screen.getByText(/Are you sure you want to permanently delete the vault/)).toBeInTheDocument();
    expect(screen.getByText("Permanently Delete")).toBeInTheDocument();
  });
});
