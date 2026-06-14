import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { ContextWindowBar } from "@/components/ContextWindowBar";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ContextWindowBar", () => {
  it("renders nothing when no tokens are used", () => {
    const { container } = render(<ContextWindowBar tokensUsed={0} contextSize={8192} />);
    expect(container.firstChild).toBeNull();
  });

  it("formats the used/total pill", () => {
    render(<ContextWindowBar tokensUsed={2234} contextSize={512} />);
    expect(screen.getByText("2.2k/512")).toBeInTheDocument();
  });

  it("invokes onConfigure when the pill is clicked", () => {
    const onConfigure = vi.fn();
    render(
      <ContextWindowBar tokensUsed={100} contextSize={512} onConfigure={onConfigure} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /context window/i }));
    expect(onConfigure).toHaveBeenCalledTimes(1);
  });

  it("labels the limit as configured when an override is set", () => {
    vi.useFakeTimers();
    render(
      <ContextWindowBar tokensUsed={100} contextSize={512} isOverride onConfigure={() => {}} />,
    );
    fireEvent.mouseEnter(screen.getByRole("button", { name: /context window/i }));
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByText(/\(configured\)/)).toBeInTheDocument();
    expect(screen.getByText(/Change in Preferences/)).toBeInTheDocument();
  });

  it("labels the limit as default when no override is set", () => {
    vi.useFakeTimers();
    render(
      <ContextWindowBar tokensUsed={100} contextSize={8192} onConfigure={() => {}} />,
    );
    fireEvent.mouseEnter(screen.getByRole("button", { name: /context window/i }));
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByText(/\(default\)/)).toBeInTheDocument();
  });
});
