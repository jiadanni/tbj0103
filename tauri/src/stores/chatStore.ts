import { create } from "zustand";

export interface Message {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model_name?: string;
  tokens_used?: number;
  created_at: string;
}

export interface ChatSession {
  id: string;
  project_id: string;
  title: string;
  model_name: string;
  system_prompt: string;
  is_pinned: boolean;
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
  setActiveChatId: (id: string | null) => void;
  setSessions: (sessions: ChatSession[]) => void;
  setMessages: (sessionId: string, messages: Message[]) => void;
  appendMessage: (sessionId: string, message: Message) => void;
  addSession: (session: ChatSession) => void;
  removeSession: (id: string) => void;
  updateSession: (session: ChatSession) => void;
  setStreamingSession: (id: string | null) => void;
  appendStreamChunk: (sessionId: string, chunk: string) => void;
  finalizeStream: (sessionId: string, modelName?: string) => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  activeChatId: null,
  sessions: [],
  messages: {},
  streamingSessionId: null,
  streamingContent: "",
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
  setStreamingSession: (streamingSessionId) =>
    set({ streamingSessionId, streamingContent: "" }),
  appendStreamChunk: (sessionId, chunk) =>
    set((s) => ({ streamingSessionId: sessionId, streamingContent: s.streamingContent + chunk })),
  finalizeStream: (sessionId, modelName) => {
    const { streamingContent } = get();
    const assistantMsg: Message = {
      id: crypto.randomUUID(),
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
}));
