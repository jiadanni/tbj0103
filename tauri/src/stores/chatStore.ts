import { create } from "zustand";

export interface Message {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model_name?: string;
  tokens_used?: number;
  duration_ms?: number;
  load_duration_ms?: number;
  variant_group_id?: string | null;
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
  exclude_from_analytics: boolean;
  is_deleted: boolean;
  deleted_at?: string;
  last_accessed_at?: string;
  is_imported?: boolean;
  created_at: string;
  updated_at: string;
  title_generated_at?: string;
  message_count_at_title_gen?: number;
  /** Persisted message count returned from the backend; 0 means truly empty. */
  message_count?: number;
}

interface ChatStore {
  activeChatId: string | null;
  sessions: ChatSession[];
  messages: Record<string, Message[]>;
  messageVariants: Record<string, Message[]>; // variants by variant_group_id
  selectedVariantIndex: Record<string, number>; // selected variant index by message_id
  streamingSessionId: string | null;
  streamingContent: string;
  // Pending prompt from text selection
  pendingPromptText: string | null;
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
  finalizeStream: (sessionId: string, modelName?: string, tokensUsed?: number, durationMs?: number, loadDurationMs?: number) => void;
  setPendingPromptText: (text: string | null) => void;
  // Message variants
  setMessageVariants: (messageId: string, variants: Message[]) => void;
  selectVariant: (messageId: string, index: number) => void;
  addMessageVariant: (newMessage: Message) => void;
  // Refine (large model second pass)
  appendRefineChunk: (sessionId: string, chunk: string) => void;
  finalizeRefine: (sessionId: string, modelName?: string) => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  activeChatId: null,
  sessions: [],
  messages: {},
  messageVariants: {},
  selectedVariantIndex: {},
  streamingSessionId: null,
  streamingContent: "",
  pendingPromptText: null,
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
  finalizeStream: (sessionId, modelName, tokensUsed, durationMs, loadDurationMs) => {
    const { streamingContent } = get();
    const assistantMsg: Message = {
      id: window.crypto.randomUUID(),
      session_id: sessionId,
      role: "assistant",
      content: streamingContent,
      model_name: modelName,
      tokens_used: tokensUsed,
      duration_ms: durationMs,
      load_duration_ms: loadDurationMs,
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
  setPendingPromptText: (pendingPromptText) => set({ pendingPromptText }),
  setMessageVariants: (messageId, variants) =>
    set((s) => ({
      messageVariants: { ...s.messageVariants, [messageId]: variants },
      selectedVariantIndex: { ...s.selectedVariantIndex, [messageId]: 0 },
    })),
  selectVariant: (messageId, index) =>
    set((s) => ({
      selectedVariantIndex: { ...s.selectedVariantIndex, [messageId]: index },
    })),
  addMessageVariant: (newMessage) => {
    set((s) => {
      const groupId = newMessage.variant_group_id;
      if (!groupId) { return s; }
      const existing = s.messageVariants[groupId] ?? [];
      return {
        messageVariants: {
          ...s.messageVariants,
          [groupId]: [newMessage, ...existing],
        },
        selectedVariantIndex: {
          ...s.selectedVariantIndex,
          [newMessage.id]: 0,
        },
      };
    });
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
  workspaceId: string,
  options?: {
    isIncognito?: boolean;
    excludeFromAnalytics?: boolean;
  }
) {
  return sessions.find((s) => {
    const isWorkspaceMatch = s.workspace_id === workspaceId;
    const isNotPinned = !s.is_pinned;
    const isNotDeleted = !s.is_deleted;
    const matchesPrivacyMode =
      s.is_incognito === (options?.isIncognito ?? false) &&
      s.exclude_from_analytics === (options?.excludeFromAnalytics ?? false);
    const isNewTitle = s.title === "New Chat" || s.title === "";
    // Prefer the backend-provided message_count (reliable after restarts).
    // Fall back to the in-memory message_count_at_title_gen for sessions that
    // were updated in this session but whose count hasn't been persisted.
    // Finally consult the in-process message store.
    const loadedMessages = messages[s.id];
    const hasNoMessages = loadedMessages?.length
      ? false
      : (s.message_count ?? s.message_count_at_title_gen ?? 0) === 0;

    return (
      isWorkspaceMatch &&
      isNotPinned &&
      isNotDeleted &&
      matchesPrivacyMode &&
      isNewTitle &&
      hasNoMessages
    );
  });
}
