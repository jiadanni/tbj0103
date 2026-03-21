import { create } from "zustand";

export interface Message {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model_name?: string;
  tokens_used?: number;
  duration_ms?: number;
  created_at: string;
}

export interface ChatSession {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  model_name: string;
  system_prompt: string;
  is_pinned: boolean;
  is_incognito: boolean;
  created_at: string;
  updated_at: string;
  title_generated_at?: string;
  message_count_at_title_gen?: number;
}

interface ChatStore {
  activeChatId: string | null;
  sessions: ChatSession[];
  messages: Record<string, Message[]>;
  streamingSessionId: string | null;
  streamingContent: string;
  // Dual-model refine phase state
  refiningSessionId: string | null;
  refineContent: string;
  setActiveChatId: (id: string | null) => void;
  setSessions: (sessions: ChatSession[]) => void;
  setMessages: (sessionId: string, messages: Message[]) => void;
  appendMessage: (sessionId: string, message: Message) => void;
  addSession: (session: ChatSession) => void;
  removeSession: (id: string) => void;
  updateSession: (session: ChatSession) => void;
  updateMessage: (sessionId: string, message: Message) => void;
  setStreamingSession: (id: string | null) => void;
  appendStreamChunk: (sessionId: string, chunk: string) => void;
  finalizeStream: (sessionId: string, modelName?: string) => void;
  // Refine (large model second pass)
  appendRefineChunk: (sessionId: string, chunk: string) => void;
  finalizeRefine: (sessionId: string, modelName?: string) => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  activeChatId: null,
  sessions: [],
  messages: {},
  streamingSessionId: null,
  streamingContent: "",
  refiningSessionId: null,
  refineContent: "",
  setActiveChatId: (activeChatId) => set({ activeChatId }),
  setSessions: (sessions) => set({ sessions }),
  setMessages: (sessionId, messages) =>
    set((s) => ({ messages: { ...s.messages, [sessionId]: messages } })),
  appendMessage: (sessionId, message) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [sessionId]: [...(s.messages[sessionId] ?? []), message],
      },
    })),
  addSession: (session) =>
    set((s) => ({ sessions: [session, ...s.sessions] })),
  removeSession: (id) =>
    set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) })),
  updateSession: (session) =>
    set((s) => ({ sessions: s.sessions.map((x) => x.id === session.id ? session : x) })),
  updateMessage: (sessionId, message) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [sessionId]: (s.messages[sessionId] ?? []).map((m) => m.id === message.id ? message : m),
      },
    })),
  setStreamingSession: (streamingSessionId) =>
    set({ streamingSessionId, streamingContent: "" }),
  appendStreamChunk: (sessionId, chunk) =>
    set((s) => ({ streamingSessionId: sessionId, streamingContent: s.streamingContent + chunk })),
  finalizeStream: (sessionId, modelName) => {
    const { streamingContent } = get();
    const assistantMsg: Message = {
      id: window.crypto.randomUUID(),
      session_id: sessionId,
      role: "assistant",
      content: streamingContent,
      model_name: modelName,
      created_at: new Date().toISOString(),
    };
    set((s) => ({
      streamingSessionId: null,
      streamingContent: "",
      messages: {
        ...s.messages,
        [sessionId]: [...(s.messages[sessionId] ?? []), assistantMsg],
      },
    }));
  },
  appendRefineChunk: (sessionId, chunk) =>
    set((s) => ({ refiningSessionId: sessionId, refineContent: s.refineContent + chunk })),
  finalizeRefine: (sessionId, modelName) => {
    const { refineContent } = get();
    // Replace the last assistant message (the draft) with the refined content
    set((s) => {
      const msgs = s.messages[sessionId] ?? [];
      const assistantEntries = msgs.map((m, i) => ({ m, i })).filter(({ m }) => m.role === "assistant");
      const lastAssistantIdx = assistantEntries.length > 0 ? assistantEntries[assistantEntries.length - 1].i : -1;
      if (lastAssistantIdx === -1) {return { refiningSessionId: null, refineContent: "" };}
      const refined: Message = {
        ...msgs[lastAssistantIdx],
        content: refineContent,
        model_name: modelName ?? msgs[lastAssistantIdx].model_name,
      };
      const updated = [...msgs];
      updated[lastAssistantIdx] = refined;
      return {
        refiningSessionId: null,
        refineContent: "",
        messages: { ...s.messages, [sessionId]: updated },
      };
    });
  },
}));

export function findUnusedSession(
  sessions: ChatSession[],
  messages: Record<string, Message[]>,
  projectId: string | null,
  isIncognito: boolean
) {
  return sessions.find((s) => {
    const isProjectMatch = s.project_id === (projectId ?? "");
    const isIncognitoMatch = s.is_incognito === isIncognito;
    const isNotPinned = !s.is_pinned;
    const isNewTitle = s.title === "New Chat" || s.title === "";
    // If we have messages loaded and there are none, it's unused.
    // If we don't have messages loaded, check message_count_at_title_gen (usually 0 for new chats).
    const hasNoMessages =
      (messages[s.id] === undefined || messages[s.id].length === 0) &&
      (s.message_count_at_title_gen === 0 || s.message_count_at_title_gen === undefined);

    return (
      isProjectMatch &&
      isIncognitoMatch &&
      isNotPinned &&
      isNewTitle &&
      hasNoMessages
    );
  });
}
