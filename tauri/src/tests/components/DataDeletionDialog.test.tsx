import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { DataDeletionDialog } from "@/components/DataDeletion/DataDeletionDialog";
import type { DataDeletionPreview } from "@/lib/api";

function mockPreview(overrides: Partial<DataDeletionPreview> = {}): DataDeletionPreview {
  return {
    workspace_count: 1,
    categories: [
      { id: "chats", label: "Chats & Messages", item_count: 5, total_rows: 25 },
      { id: "notes", label: "Notes & Templates", item_count: 3, total_rows: 8 },
    ],
    total_items: 8,
    total_rows: 33,
    ...overrides,
  };
}

describe("DataDeletionDialog", () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders dialog with category counts and total items", () => {
    render(
      <DataDeletionDialog
        scopeDescription="Workspace Alpha"
        timeFilter="all"
        selectedCategories={["chats", "notes"]}
        preview={mockPreview()}
        loadingPreview={false}
        running={false}
        error={null}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.getByRole("heading", { name: /Permanently Delete Workspace Data/i })).toBeTruthy();
    expect(screen.getByText(/Workspace Alpha/i)).toBeTruthy();
    expect(screen.getByText(/Chats & Messages/i)).toBeTruthy();
    expect(screen.getByText(/Notes & Templates/i)).toBeTruthy();
    expect(screen.getByText(/8 items · 33 total records/i)).toBeTruthy();
  });

  it("enables delete button directly when total items < 50 without typed confirmation", () => {
    render(
      <DataDeletionDialog
        scopeDescription="Workspace Alpha"
        timeFilter="all"
        selectedCategories={["chats"]}
        preview={mockPreview({ total_items: 8 })}
        loadingPreview={false}
        running={false}
        error={null}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    const deleteBtn = screen.getByRole("button", { name: /Permanently Delete Data/i });
    expect(deleteBtn).not.toBeDisabled();

    fireEvent.click(deleteBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("requires typing 'delete' when total items >= 50", () => {
    render(
      <DataDeletionDialog
        scopeDescription="Workspace Alpha"
        timeFilter="all"
        selectedCategories={["chats"]}
        preview={mockPreview({ total_items: 55, total_rows: 250 })}
        loadingPreview={false}
        running={false}
        error={null}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    const deleteBtn = screen.getByRole("button", { name: /Permanently Delete Data/i });
    expect(deleteBtn).toBeDisabled();

    const input = screen.getByPlaceholderText("delete");
    expect(input).toBeTruthy();

    fireEvent.change(input, { target: { value: "del" } });
    expect(deleteBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: "DELETE" } });
    expect(deleteBtn).not.toBeDisabled();

    fireEvent.click(deleteBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("triggers onCancel when Cancel button is clicked", () => {
    render(
      <DataDeletionDialog
        scopeDescription="Workspace Alpha"
        timeFilter="all"
        selectedCategories={["chats"]}
        preview={mockPreview()}
        loadingPreview={false}
        running={false}
        error={null}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("displays loading spinner when loading preview", () => {
    render(
      <DataDeletionDialog
        scopeDescription="Workspace Alpha"
        timeFilter="all"
        selectedCategories={["chats"]}
        preview={null}
        loadingPreview={true}
        running={false}
        error={null}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText(/Scanning database and calculating affected records/i)).toBeTruthy();
  });

  it("displays error message if deletion preview or execution fails", () => {
    render(
      <DataDeletionDialog
        scopeDescription="Workspace Alpha"
        timeFilter="all"
        selectedCategories={["chats"]}
        preview={null}
        loadingPreview={false}
        running={false}
        error="Authentication required for destructive operations"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText(/Authentication required for destructive operations/i)).toBeTruthy();
  });
});
