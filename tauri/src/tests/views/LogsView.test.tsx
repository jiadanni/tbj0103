import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import LogsView from "@/views/LogsView";
import { api } from "@/lib/api";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => vi.fn()),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock("@/lib/api", () => ({
  api: {
    logs: {
      get: vi.fn(),
      getSources: vi.fn(() => Promise.resolve(["app", "database", "network"])),
      clear: vi.fn(() => Promise.resolve(0)),
    },
  },
}));

const mockLogs = [
  {
    id: 1,
    timestamp: "2026-09-12 10:00:00",
    level: "info",
    source: "app",
    message: "Application initialized",
    metadata: "{}",
  },
  {
    id: 2,
    timestamp: "2026-09-12 10:05:00",
    level: "error",
    source: "network",
    message: "Failed to connect to server",
    metadata: '{"status":500,"url":"https://api.example.com"}',
  },
];

describe("LogsView export and filtering functionality", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders logs and exports them using save dialog and writeTextFile with Filter exports enabled", async () => {
    vi.mocked(api.logs.get).mockResolvedValueOnce(mockLogs);
    vi.mocked(saveDialog).mockResolvedValueOnce("/path/to/exported-logs.txt" as unknown as null);

    render(<LogsView />);

    // Wait for logs to be rendered in the table
    await waitFor(() => {
      expect(screen.getByText("Application initialized")).toBeInTheDocument();
      expect(screen.getByText("Failed to connect to server")).toBeInTheDocument();
    });

    const filterExportsCheckbox = screen.getByRole("checkbox", { name: /filter exports/i });
    expect(filterExportsCheckbox).toBeChecked();

    const exportBtn = screen.getByRole("button", { name: /export filtered logs/i });
    expect(exportBtn).not.toBeDisabled();

    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(saveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Export Filtered Logs",
          filters: [
            { name: "Text Files", extensions: ["txt", "log"] },
            { name: "All Files", extensions: ["*"] },
          ],
        })
      );
    });

    await waitFor(() => {
      expect(writeTextFile).toHaveBeenCalledWith(
        "/path/to/exported-logs.txt",
        expect.stringContaining("[2026-09-12 10:00:00] [INFO] [app] Application initialized")
      );
      expect(writeTextFile).toHaveBeenCalledWith(
        "/path/to/exported-logs.txt",
        expect.stringContaining('[2026-09-12 10:05:00] [ERROR] [network] Failed to connect to server {"status":500,"url":"https://api.example.com"}')
      );
    });

    // Button should update to indicate success
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /logs exported/i })).toBeInTheDocument();
    });
  });

  it("exports all logs when Filter exports is unchecked", async () => {
    vi.mocked(api.logs.get)
      .mockResolvedValueOnce(mockLogs) // initial fetch
      .mockResolvedValueOnce([         // unfiltered export fetch
        ...mockLogs,
        {
          id: 3,
          timestamp: "2026-09-11 08:00:00",
          level: "debug",
          source: "system",
          message: "System boots",
          metadata: "{}",
        },
      ]);
    vi.mocked(saveDialog).mockResolvedValueOnce("/path/to/all-logs.txt" as unknown as null);

    render(<LogsView />);

    await waitFor(() => {
      expect(screen.getByText("Application initialized")).toBeInTheDocument();
    });

    const filterExportsCheckbox = screen.getByRole("checkbox", { name: /filter exports/i });
    fireEvent.click(filterExportsCheckbox);
    expect(filterExportsCheckbox).not.toBeChecked();

    const exportBtn = screen.getByRole("button", { name: /export all logs/i });
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(saveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Export All Logs",
        })
      );
    });

    await waitFor(() => {
      expect(writeTextFile).toHaveBeenCalledWith(
        "/path/to/all-logs.txt",
        expect.stringContaining("System boots")
      );
    });
  });

  it("filters logs by date range and passes after and before params to api.logs.get", async () => {
    vi.mocked(api.logs.get).mockResolvedValue(mockLogs);

    render(<LogsView />);

    await waitFor(() => {
      expect(api.logs.get).toHaveBeenCalledWith(
        expect.objectContaining({
          after: undefined,
          before: undefined,
        })
      );
    });

    const startDateInput = screen.getByLabelText(/start date/i);
    const endDateInput = screen.getByLabelText(/end date/i);

    fireEvent.change(startDateInput, { target: { value: "2026-09-01" } });
    fireEvent.change(endDateInput, { target: { value: "2026-09-12" } });

    await waitFor(() => {
      expect(api.logs.get).toHaveBeenCalledWith(
        expect.objectContaining({
          after: "2026-09-01",
          before: "2026-09-12T23:59:59",
        })
      );
    });

    // Clear button should appear and reset date range
    const clearDateBtn = screen.getByRole("button", { name: /clear date range/i });
    fireEvent.click(clearDateBtn);

    await waitFor(() => {
      expect(api.logs.get).toHaveBeenLastCalledWith(
        expect.objectContaining({
          after: undefined,
          before: undefined,
        })
      );
    });
  });

  it("does not call writeTextFile if user cancels save dialog", async () => {
    vi.mocked(api.logs.get).mockResolvedValueOnce(mockLogs);
    vi.mocked(saveDialog).mockResolvedValueOnce(null);

    render(<LogsView />);

    await waitFor(() => {
      expect(screen.getByText("Application initialized")).toBeInTheDocument();
    });

    const exportBtn = screen.getByRole("button", { name: /export filtered logs/i });
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(saveDialog).toHaveBeenCalled();
    });

    expect(writeTextFile).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /logs exported/i })).not.toBeInTheDocument();
  });

  it("disables the export button when there are no logs and Filter exports is checked", async () => {
    vi.mocked(api.logs.get).mockResolvedValueOnce([]);

    render(<LogsView />);

    await waitFor(() => {
      expect(screen.getByText("No log entries")).toBeInTheDocument();
    });

    const exportBtn = screen.getByRole("button", { name: /export filtered logs/i });
    expect(exportBtn).toBeDisabled();

    fireEvent.click(exportBtn);
    expect(saveDialog).not.toHaveBeenCalled();
    expect(writeTextFile).not.toHaveBeenCalled();
  });
});
