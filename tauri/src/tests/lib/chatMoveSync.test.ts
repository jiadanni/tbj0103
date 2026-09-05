import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, message } = vi.hoisted(() => ({
  invoke: vi.fn(),
  message: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message }));

import { api } from "../../lib/api";

describe("committed chat move synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    message.mockResolvedValue(undefined);
  });

  it("returns committed moves without waiting for a warning to close", async () => {
    const result = {
      file_sync_pending: true,
      file_sync_error: "Chat changes saved; file sync pending.",
    };
    invoke.mockResolvedValue(result);
    message.mockReturnValue(new Promise(() => {}));

    await expect(api.chat.moveSessions(["session"], "destination")).resolves.toBe(result);
    expect(invoke).toHaveBeenCalledWith("move_chat_sessions", {
      sessionIds: ["session"],
      targetWorkspaceId: "destination",
      targetFolderId: undefined,
    });
    expect(message).toHaveBeenCalledWith(result.file_sync_error, {
      title: "Chat files pending",
      kind: "warning",
    });
  });

  it("never rejects a committed batch when warning delivery fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = {
      sessions_moved: 2,
      folders_created: [],
      folder_mapping: {},
      file_sync_pending: true,
      file_sync_error: "File synchronization pending.",
    };
    invoke.mockResolvedValue(result);
    message.mockRejectedValue(new Error("Dialog unavailable"));

    await expect(api.chat.batchMoveSessions(["one", "two"], "destination", false))
      .resolves.toBe(result);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("warning could not be displayed"),
      expect.objectContaining({ warning: result.file_sync_error, error: "Dialog unavailable" }),
    );
    errorLog.mockRestore();
  });

  it("retries the durable queue without showing a warning after success", async () => {
    const result = { file_sync_pending: false, file_sync_error: null };
    invoke.mockResolvedValue(result);
    await expect(api.chat.retryFileSync()).resolves.toBe(result);
    expect(invoke).toHaveBeenCalledWith("retry_chat_file_sync", undefined);
    expect(message).not.toHaveBeenCalled();
  });

  it("still rejects database failures before the move commits", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    invoke.mockRejectedValue(new Error("Database unavailable"));
    await expect(api.chat.moveSessions(["session"], "destination"))
      .rejects.toThrow("Database unavailable");
    expect(message).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });
});
