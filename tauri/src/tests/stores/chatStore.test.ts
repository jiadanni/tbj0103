import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { useChatStore } from "@/stores/chatStore";
import type { Message, ChatSession } from "@/stores/chatStore";

// Stub crypto.randomUUID for deterministic IDs
beforeAll(() => {
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "00000000-0000-0000-0000-000000000000" as `${string}-${string}-${string}-${string}-${string}`) });
});

const INITIAL = {
  activeChatId: null,
  sessions: [],
  messages: {},
  streamingSessionId: null,
  streamingContent: "",
  refiningSessionId: null,
  refineContent: "",
};

beforeEach(() => {
  // Merge mode (no 'true' flag) preserves the action functions on the store.
  useChatStore.setState(INITIAL);
  vi.mocked(window.crypto.randomUUID).mockReturnValue("00000000-0000-0000-0000-000000000000" as `${string}-${string}-${string}-${string}-${string}`);
});

// ─── helpers ────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "s1",
    workspace_id: "ws1",
    project_id: "p1",
    title: "Test Session",
    model_name: "llama3",
    system_prompt: "",
    is_pinned: false,
    is_incognito: false,
    exclude_from_analytics: false,
    is_deleted: false,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    session_id: "s1",
    role: "user",
    content: "Hello",
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// ─── setActiveChatId ────────────────────────────────────────────────────────

describe("setActiveChatId", () => {
  it("sets an id", () => {
    useChatStore.getState().setActiveChatId("abc");
    expect(useChatStore.getState().activeChatId).toBe("abc");
  });

  it("can set to null", () => {
    useChatStore.getState().setActiveChatId("abc");
    useChatStore.getState().setActiveChatId(null);
    expect(useChatStore.getState().activeChatId).toBeNull();
  });
});

// ─── setSessions ────────────────────────────────────────────────────────────

describe("setSessions", () => {
  it("replaces the sessions array", () => {
    const sessions = [makeSession(), makeSession({ id: "s2" })];
    useChatStore.getState().setSessions(sessions);
    expect(useChatStore.getState().sessions).toEqual(sessions);
  });
});

// ─── setMessages ────────────────────────────────────────────────────────────

describe("setMessages", () => {
  it("keys messages by session id", () => {
    const msgs = [makeMessage()];
    useChatStore.getState().setMessages("s1", msgs);
    expect(useChatStore.getState().messages["s1"]).toEqual(msgs);
  });

  it("does not overwrite other session messages", () => {
    useChatStore.getState().setMessages("s1", [makeMessage({ id: "m1" })]);
    useChatStore.getState().setMessages("s2", [makeMessage({ id: "m2", session_id: "s2" })]);
    expect(useChatStore.getState().messages["s1"]).toHaveLength(1);
    expect(useChatStore.getState().messages["s2"]).toHaveLength(1);
  });
});

// ─── appendMessage ──────────────────────────────────────────────────────────

describe("appendMessage", () => {
  it("initialises an empty session on first append", () => {
    const msg = makeMessage();
    useChatStore.getState().appendMessage("s1", msg);
    expect(useChatStore.getState().messages["s1"]).toEqual([msg]);
  });

  it("appends to an existing session", () => {
    const m1 = makeMessage({ id: "m1" });
    const m2 = makeMessage({ id: "m2" });
    useChatStore.getState().setMessages("s1", [m1]);
    useChatStore.getState().appendMessage("s1", m2);
    expect(useChatStore.getState().messages["s1"]).toEqual([m1, m2]);
  });
});

// ─── addSession ─────────────────────────────────────────────────────────────

describe("addSession", () => {
  it("prepends a new session", () => {
    const existing = makeSession({ id: "existing" });
    useChatStore.setState({ sessions: [existing] });
    const newSession = makeSession({ id: "new" });
    useChatStore.getState().addSession(newSession);
    expect(useChatStore.getState().sessions[0].id).toBe("new");
    expect(useChatStore.getState().sessions[1].id).toBe("existing");
  });
});

// ─── removeSession ──────────────────────────────────────────────────────────

describe("removeSession", () => {
  it("removes the session matching the id", () => {
    useChatStore.setState({ sessions: [makeSession({ id: "a" }), makeSession({ id: "b" })] });
    useChatStore.getState().removeSession("a");
    expect(useChatStore.getState().sessions).toHaveLength(1);
    expect(useChatStore.getState().sessions[0].id).toBe("b");
  });
});

// ─── updateSession ──────────────────────────────────────────────────────────

describe("updateSession", () => {
  it("replaces the matching session in place", () => {
    const original = makeSession({ id: "s1", title: "Old" });
    const updated = makeSession({ id: "s1", title: "New" });
    useChatStore.setState({ sessions: [original] });
    useChatStore.getState().updateSession(updated);
    expect(useChatStore.getState().sessions[0].title).toBe("New");
  });
});

// ─── updateMessage ──────────────────────────────────────────────────────────

describe("updateMessage", () => {
  it("replaces the matching message in place", () => {
    const original = makeMessage({ id: "m1", content: "Old" });
    const updated = makeMessage({ id: "m1", content: "New" });
    useChatStore.setState({ messages: { s1: [original] } });
    useChatStore.getState().updateMessage("s1", updated);
    expect(useChatStore.getState().messages["s1"][0].content).toBe("New");
  });
});

// ─── setStreamingSession ────────────────────────────────────────────────────

describe("setStreamingSession", () => {
  it("sets the streaming session id and clears content", () => {
    useChatStore.setState({ streamingSessionId: "old", streamingContent: "some content" });
    useChatStore.getState().setStreamingSession("s1");
    expect(useChatStore.getState().streamingSessionId).toBe("s1");
    expect(useChatStore.getState().streamingContent).toBe("");
  });
});

// ─── appendStreamChunk ──────────────────────────────────────────────────────

describe("appendStreamChunk", () => {
  it("accumulates chunks", () => {
    useChatStore.getState().appendStreamChunk("s1", "Hello");
    useChatStore.getState().appendStreamChunk("s1", " World");
    expect(useChatStore.getState().streamingContent).toBe("Hello World");
    expect(useChatStore.getState().streamingSessionId).toBe("s1");
  });
});

// ─── finalizeStream ──────────────────────────────────────────────────────────

describe("finalizeStream", () => {
  it("creates an assistant message, clears stream state, assigns model_name, generates UUID", () => {
    useChatStore.setState({ streamingContent: "AI response", streamingSessionId: "s1" });
    useChatStore.getState().finalizeStream("s1", "llama3");

    const state = useChatStore.getState();
    expect(state.streamingSessionId).toBeNull();
    expect(state.streamingContent).toBe("");

    const msgs = state.messages["s1"];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("assistant");
    expect(msgs[0].content).toBe("AI response");
    expect(msgs[0].model_name).toBe("llama3");
    expect(msgs[0].id).toBe("00000000-0000-0000-0000-000000000000");
  });
});

// ─── appendRefineChunk ──────────────────────────────────────────────────────

describe("appendRefineChunk", () => {
  it("accumulates independently from stream content", () => {
    useChatStore.setState({ streamingContent: "stream" });
    useChatStore.getState().appendRefineChunk("s1", "Refined ");
    useChatStore.getState().appendRefineChunk("s1", "answer");
    expect(useChatStore.getState().refineContent).toBe("Refined answer");
    expect(useChatStore.getState().streamingContent).toBe("stream"); // unchanged
  });
});

// ─── finalizeRefine ──────────────────────────────────────────────────────────

describe("finalizeRefine", () => {
  it("replaces the last assistant message content", () => {
    const draft = makeMessage({ id: "m1", role: "assistant", content: "draft" });
    useChatStore.setState({ messages: { s1: [draft] }, refineContent: "refined" });
    useChatStore.getState().finalizeRefine("s1");
    expect(useChatStore.getState().messages["s1"][0].content).toBe("refined");
    expect(useChatStore.getState().refineContent).toBe("");
    expect(useChatStore.getState().refiningSessionId).toBeNull();
  });

  it("no-op guard — returns early when no assistant message exists", () => {
    const userMsg = makeMessage({ id: "m1", role: "user", content: "hello" });
    useChatStore.setState({ messages: { s1: [userMsg] }, refineContent: "refined" });
    useChatStore.getState().finalizeRefine("s1");
    // User message content unchanged
    expect(useChatStore.getState().messages["s1"][0].content).toBe("hello");
    expect(useChatStore.getState().refiningSessionId).toBeNull();
  });

  it("leaves earlier assistant messages untouched", () => {
    const first = makeMessage({ id: "m1", role: "assistant", content: "first" });
    const second = makeMessage({ id: "m2", role: "assistant", content: "draft" });
    useChatStore.setState({ messages: { s1: [first, second] }, refineContent: "refined" });
    useChatStore.getState().finalizeRefine("s1");
    expect(useChatStore.getState().messages["s1"][0].content).toBe("first");
    expect(useChatStore.getState().messages["s1"][1].content).toBe("refined");
  });

  it("updates model_name when provided", () => {
    const draft = makeMessage({ id: "m1", role: "assistant", content: "draft", model_name: "llama3" });
    useChatStore.setState({ messages: { s1: [draft] }, refineContent: "refined" });
    useChatStore.getState().finalizeRefine("s1", "gpt-4");
    expect(useChatStore.getState().messages["s1"][0].model_name).toBe("gpt-4");
  });
});
