import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ProjectNote } from "../../lib/api";
import { discardNoteDraft, flushNoteDraft, refreshNoteDrafts, useNoteDraft, useNoteDraftStore } from "../../hooks/useNoteDraft";

vi.mock("../../lib/api", () => ({ api: { note: { update: vi.fn() } } }));

const note: ProjectNote = {
  id: "note-1", workspace_id: "ws-1", title: "One", content: "Original",
  tags: ["tag"], is_pinned: true, folder: null, note_type: "general",
  created_at: "", updated_at: "",
};

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api.note.update).mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => {
    for (const id of Object.keys(useNoteDraftStore.getState().drafts)) {
      await flushNoteDraft(id);
      discardNoteDraft(id);
    }
  });
  vi.useRealTimers();
});

describe("note draft queue", () => {
  it("does not save an untouched note and flushes edits before the debounce", async () => {
    const { result } = renderHook(() => useNoteDraft(note));
    await act(async () => { await result.current.flush(); });
    expect(api.note.update).not.toHaveBeenCalled();
    act(() => result.current.update({ ...result.current.fields, content: "Edited" }));
    expect(result.current.dirty).toBe(true);
    await act(async () => { expect(await result.current.flush()).toBe(true); });
    expect(api.note.update).toHaveBeenCalledWith("note-1", expect.objectContaining({
      content: "Edited", tags: ["tag"], is_pinned: true,
    }));
    expect(result.current.dirty).toBe(false);
  });

  it("flushes navigation/unmount and keeps a rejected draft available on remount", async () => {
    const pending = deferred();
    vi.mocked(api.note.update).mockReturnValueOnce(pending.promise);
    const first = renderHook(() => useNoteDraft(note));
    act(() => first.result.current.update({ ...first.result.current.fields, content: "Keep me" }));
    first.unmount();
    expect(api.note.update).toHaveBeenCalledTimes(1);
    await act(async () => { pending.reject(new Error("Database locked")); });
    const second = renderHook(() => useNoteDraft(note));
    expect(second.result.current.fields.content).toBe("Keep me");
    expect(second.result.current.error).toContain("Database locked");
    expect(second.result.current.dirty).toBe(true);
    await act(async () => { expect(await second.result.current.flush()).toBe(true); });
    expect(second.result.current.error).toBeNull();
  });

  it("serializes revisions and coalesces overlapping flush calls", async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(api.note.update).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useNoteDraft(note));
    act(() => result.current.update({ ...result.current.fields, content: "Older" }));
    let flush!: Promise<boolean>;
    act(() => { flush = result.current.flush(); });
    act(() => result.current.update({ ...result.current.fields, content: "Newest" }));
    expect(result.current.flush()).toBe(flush);
    expect(api.note.update).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(); });
    expect(api.note.update).toHaveBeenCalledTimes(2);
    expect(api.note.update).toHaveBeenLastCalledWith("note-1", expect.objectContaining({ content: "Newest" }));
    expect(result.current.saving).toBe(true);
    expect(result.current.fields.content).toBe("Newest");
    await act(async () => { second.resolve(); await flush; });
    expect(result.current.dirty).toBe(false);
  });

  it("binds edits to their original note when changing notes rapidly", async () => {
    const pending = deferred();
    vi.mocked(api.note.update).mockReturnValueOnce(pending.promise);
    const { result, rerender, unmount } = renderHook(({ current }) => useNoteDraft(current), { initialProps: { current: note } });
    act(() => result.current.update({ ...result.current.fields, title: "First draft" }));
    rerender({ current: { ...note, id: "note-2", workspace_id: "ws-2", title: "Second" } });
    expect(result.current.fields.title).toBe("Second");
    act(() => result.current.update({ ...result.current.fields, title: "Second draft" }));
    unmount();
    expect(api.note.update).toHaveBeenNthCalledWith(1, "note-1", expect.objectContaining({ title: "First draft" }));
    expect(api.note.update).toHaveBeenNthCalledWith(2, "note-2", expect.objectContaining({ title: "Second draft" }));
    await act(async () => { pending.resolve(); });
    expect(useNoteDraftStore.getState().drafts["note-2"].fields.title).toBe("Second draft");
  });

  it("retains the newest revision after an older request fails", async () => {
    const pending = deferred();
    vi.mocked(api.note.update).mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useNoteDraft(note));
    act(() => result.current.update({ ...result.current.fields, content: "Old" }));
    let flush!: Promise<boolean>;
    act(() => { flush = result.current.flush(); });
    act(() => result.current.update({ ...result.current.fields, content: "New" }));
    await act(async () => { pending.reject(new Error("Offline")); expect(await flush).toBe(false); });
    expect(result.current.fields.content).toBe("New");
    await act(async () => { await result.current.flush(); });
    expect(api.note.update).toHaveBeenLastCalledWith("note-1", expect.objectContaining({ content: "New" }));
  });

  it("warns and starts a best-effort flush on beforeunload", async () => {
    const { result } = renderHook(() => useNoteDraft(note));
    act(() => result.current.update({ ...result.current.fields, content: "Pending" }));
    const event = new Event("beforeunload", { cancelable: true });
    await act(async () => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(api.note.update).toHaveBeenCalledWith("note-1", expect.objectContaining({ content: "Pending" }));
  });

  it("shares note revisions between panes and ignores lists started before the latest save", async () => {
    const primary = renderHook(() => useNoteDraft(note));
    const secondary = renderHook(() => useNoteDraft(note));
    act(() => primary.result.current.update({ ...primary.result.current.fields, content: "Shared draft" }));
    expect(secondary.result.current.fields.content).toBe("Shared draft");
    const snapshot = useNoteDraftStore.getState().drafts;
    await act(async () => { await primary.result.current.flush(); });
    act(() => refreshNoteDrafts([note], snapshot));
    expect(secondary.result.current.fields.content).toBe("Shared draft");
    act(() => refreshNoteDrafts([{ ...note, content: "New database value" }], useNoteDraftStore.getState().drafts));
    expect(primary.result.current.fields.content).toBe("New database value");
    expect(secondary.result.current.fields.content).toBe("New database value");
    expect(api.note.update).toHaveBeenCalledWith("note-1", {
      title: "One", content: "Shared draft", tags: ["tag"], is_pinned: true,
    });
  });
});
