import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import WindowAuthGate from "@/components/WindowAuthGate";
import { listen } from "@tauri-apps/api/event";

const mocks = vi.hoisted(() => ({
  checkState: vi.fn(),
  isUnlocked: vi.fn(),
  listeners: new Map<string, () => void>(),
}));
vi.mock("@/lib/api", () => ({
  api: { boot: { checkState: mocks.checkState }, security: { isUnlocked: mocks.isUnlocked } },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: () => void) => {
    mocks.listeners.set(event, handler);
    return () => mocks.listeners.delete(event);
  }),
}));
vi.mock("@/views/AuthenticationView", () => ({
  default: ({ onAuthenticated }: { onAuthenticated: () => void }) => (
    <button onClick={onAuthenticated}>Authenticate</button>
  ),
}));

describe("secondary-window authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkState.mockReset();
    mocks.isUnlocked.mockReset();
    mocks.listeners.clear();
    mocks.checkState.mockResolvedValue({ unlock_required: false, pending_action: "" });
    mocks.isUnlocked.mockResolvedValue(false);
  });

  it("does not mount sensitive content until the backend confirms unlock", async () => {
    render(<WindowAuthGate><div>Sensitive preferences</div></WindowAuthGate>);
    await screen.findByRole("button", { name: "Authenticate" });
    expect(screen.queryByText("Sensitive preferences")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Authenticate" }));
    expect(screen.queryByText("Sensitive preferences")).not.toBeInTheDocument();
    mocks.isUnlocked.mockResolvedValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Authenticate" }));
    await screen.findByText("Sensitive preferences");
    act(() => mocks.listeners.get("app-locked")?.());
    expect(screen.queryByText("Sensitive preferences")).not.toBeInTheDocument();
  });

  it("preserves no-lock and already-unlocked secondary windows", async () => {
    mocks.isUnlocked.mockResolvedValue(true);
    render(<WindowAuthGate><div>Search results</div></WindowAuthGate>);
    await screen.findByText("Search results");
  });

  it("fails closed when auth probing rejects", async () => {
    mocks.isUnlocked.mockRejectedValue(new Error("DB unavailable"));
    render(<WindowAuthGate><div>Private content</div></WindowAuthGate>);
    await screen.findByRole("alert");
    expect(screen.queryByText("Private content")).not.toBeInTheDocument();
  });

  it("never exposes data when the lock event permission is denied", async () => {
    vi.mocked(listen).mockRejectedValueOnce(new Error("event.listen not allowed"));
    mocks.isUnlocked.mockResolvedValue(true);
    render(<WindowAuthGate><div>Private content</div></WindowAuthGate>);
    await screen.findByRole("alert");
    expect(mocks.isUnlocked).not.toHaveBeenCalled();
    expect(screen.queryByText("Private content")).not.toBeInTheDocument();
  });

  it("requires cold encrypted boot in the main window", async () => {
    mocks.checkState.mockResolvedValue({ unlock_required: true, pending_action: "" });
    render(<WindowAuthGate><div>Private content</div></WindowAuthGate>);
    await screen.findByText("Unlock the database in the main window first.");
    expect(mocks.isUnlocked).not.toHaveBeenCalled();
    expect(screen.queryByText("Private content")).not.toBeInTheDocument();
  });
});
