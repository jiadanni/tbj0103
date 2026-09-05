import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AuthenticationView from "@/views/AuthenticationView";

const security = vi.hoisted(() => ({
  getStatus: vi.fn(),
  unlockApp: vi.fn(),
  authenticateBiometric: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: { security } }));
vi.mock("@/components/WindowControls", () => ({
  default: () => null,
  onDragRegionMouseDown: vi.fn(),
  onDragRegionDoubleClick: vi.fn(),
}));

describe("AuthenticationView", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    security.getStatus.mockResolvedValue({ pin_lock_enabled: true, touch_id_enabled: false });
  });

  it("never authenticates when security discovery fails", async () => {
    security.getStatus.mockRejectedValue(new Error("Database unavailable"));
    const authenticated = vi.fn();
    render(<AuthenticationView onAuthenticated={authenticated} />);
    await screen.findByText("Database unavailable");
    expect(authenticated).not.toHaveBeenCalled();
  });

  it("only authenticates after the backend accepts the PIN", async () => {
    const authenticated = vi.fn();
    security.unlockApp.mockRejectedValueOnce(new Error("Incorrect PIN."));
    render(<AuthenticationView onAuthenticated={authenticated} />);
    await waitFor(() => expect(security.getStatus).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText("PIN passcode"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await screen.findByText("Incorrect PIN.");
    expect(authenticated).not.toHaveBeenCalled();
    security.unlockApp.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(authenticated).toHaveBeenCalledOnce());
    expect(security.unlockApp).toHaveBeenLastCalledWith({ pin: "1234" });
  });

  it("uses the trusted biometric command without a renderer unlock claim", async () => {
    security.getStatus.mockResolvedValue({ pin_lock_enabled: true, touch_id_enabled: true });
    security.authenticateBiometric.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const authenticated = vi.fn();
    render(<AuthenticationView onAuthenticated={authenticated} />);
    fireEvent.click(await screen.findByRole("button", { name: "Use Touch ID" }));
    await screen.findByText("Touch ID was not recognised. Try your PIN instead.");
    expect(authenticated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use Touch ID" }));
    await waitFor(() => expect(authenticated).toHaveBeenCalledOnce());
    expect(security.unlockApp).not.toHaveBeenCalled();
  });
});
