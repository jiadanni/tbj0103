import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { Send, Plus, Trash2, Copy, ChevronDown } from "lucide-react";
import { api } from "../lib/api";
import { useChatStore } from "../stores/chatStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { ChatSession } from "../stores/chatStore";

export default function ChatView() {
  const { sessionId } = useParams();

  const {
    sessions, messages, activeChatId, setActiveChatId,
    setSessions, setMessages, appendMessage, appendStreamChunk, finalizeStream,
    streamingSessionId, streamingContent,
  } = useChatStore();

  const { activeProjectId } = useWorkspaceStore();
  const { preferredModel, ollamaUrl } = useSettingsStore();

  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedModel, setSelectedModel] = useState(preferredModel || "llama3.2");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [showSessions, setShowSessions] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeMessages = activeChatId ? (messages[activeChatId] ?? []) : [];
  const isCurrentlyStreaming = streamingSessionId === activeChatId;

  // Load sessions for active project
  useEffect(() => {
    if (!activeProjectId) return;
    api.chat.listSessions(activeProjectId).then(setSessions).catch(() => {});
  }, [activeProjectId, setSessions]);

  // Activate session from URL
  useEffect(() => {
    if (sessionId) setActiveChatId(sessionId);
  }, [sessionId, setActiveChatId]);

  // Load messages when session changes
  useEffect(() => {
    if (!activeChatId || messages[activeChatId]) return;
    api.chat.getMessages(activeChatId)
      .then((msgs) => setMessages(activeChatId, msgs))
      .catch(() => {});
  }, [activeChatId, messages, setMessages]);

  // Load available models
  useEffect(() => {
    api.ollama.listModels(ollamaUrl).then((m) => {
      if (m.length > 0) setAvailableModels(m.map((x) => x.name));
    }).catch(() => {});
  }, [ollamaUrl]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeMessages.length, streamingContent]);

  async function createNewSession() {
    if (!activeProjectId) return;
    const session = await api.chat.createSession(activeProjectId, { modelName: selectedModel });
    useChatStore.getState().addSession(session);
    setActiveChatId(session.id);
    setMessages(session.id, []);
  }

  async function sendMessage() {
    if (!input.trim() || isStreaming || !activeProjectId) return;

    let sessionId = activeChatId;
    if (!sessionId) {
      const session = await api.chat.createSession(activeProjectId, { modelName: selectedModel });
      useChatStore.getState().addSession(session);
      sessionId = session.id;
      setActiveChatId(session.id);
      setMessages(session.id, []);
    }

    const userContent = input.trim();
    setInput("");
    setIsStreaming(true);

    // Persist user message
    const userMsg = await api.chat.addMessage(sessionId, "user", userContent);
    appendMessage(sessionId, userMsg);

    // Build context for Ollama
    const history = (messages[sessionId] ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    history.push({ role: "user", content: userContent });

    try {
      // Start listening to stream events BEFORE calling send
      const unlisten = await api.listenStream(sessionId, (chunk, done) => {
        if (done) {
          finalizeStream(sessionId, selectedModel);
          setIsStreaming(false);
          unlisten();
          // Persist the assembled content
          const assembled = useChatStore.getState().streamingContent;
          api.chat.addMessage(sessionId!, "assistant", assembled).catch(() => {});
        } else {
          appendStreamChunk(sessionId!, chunk);
        }
      });

      await api.ollama.sendMessage(sessionId, selectedModel, history, true, ollamaUrl);
    } catch (err) {
      setIsStreaming(false);
      const errMsg = err instanceof Error ? err.message : String(err);
      appendStreamChunk(sessionId, `\n\n⚠️ Error: ${errMsg}`);
      finalizeStream(sessionId, selectedModel);
    }

    // Auto-generate title after first message
    if (activeMessages.length === 0) {
      api.ollama.generateTitle(selectedModel, userContent, ollamaUrl)
        .then((title) => {
          const updatedSession = { ...sessions.find(s => s.id === sessionId)!, title };
          useChatStore.getState().updateSession(updatedSession);
        }).catch(() => {});
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function deleteSession(id: string) {
    await api.chat.deleteSession(id);
    useChatStore.getState().removeSession(id);
    if (activeChatId === id) setActiveChatId(null);
  }

  function copyMessage(content: string) {
    navigator.clipboard.writeText(content);
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Session list panel */}
      <div className="w-52 border-r border-[var(--border-color)] flex flex-col bg-[var(--bg-sidebar)] overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-color)]">
          <span className="text-xs font-medium text-[var(--text-secondary)]">Sessions</span>
          <button
            onClick={createNewSession}
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="New session"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 && (
            <p className="px-3 py-6 text-xs text-center text-[var(--text-muted)]">No sessions yet</p>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => setActiveChatId(s.id)}
              className={`group flex items-center gap-1 px-3 py-2 cursor-pointer transition-colors ${
                activeChatId === s.id
                  ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <span className="flex-1 text-xs truncate">{s.title || "New Chat"}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-red-400 transition-all"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--bg-primary)]">
          <span className="text-sm font-medium text-[var(--text-primary)] flex-1 truncate">
            {sessions.find((s) => s.id === activeChatId)?.title || "New Chat"}
          </span>
          {/* Model selector */}
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="text-xs px-2 py-1 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-secondary)] outline-none"
          >
            {availableModels.length > 0
              ? availableModels.map((m) => <option key={m} value={m}>{m}</option>)
              : <option value={selectedModel}>{selectedModel}</option>
            }
          </select>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {!activeChatId && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-4">
              <p className="text-[var(--text-muted)] text-sm">
                {activeProjectId ? "Start a new conversation" : "Select a project to begin"}
              </p>
              {activeProjectId && (
                <button
                  onClick={createNewSession}
                  className="px-4 py-2 bg-[var(--accent-color)] text-white rounded-lg text-sm hover:opacity-90"
                >
                  New Chat
                </button>
              )}
            </div>
          )}

          {activeMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                  msg.role === "user"
                    ? "message-user"
                    : "message-assistant"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm prose-invert max-w-none">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
              <button
                onClick={() => copyMessage(msg.content)}
                className="opacity-0 hover:opacity-100 p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-opacity"
                title="Copy"
              >
                <Copy size={11} />
              </button>
            </div>
          ))}

          {/* Streaming bubble */}
          {isCurrentlyStreaming && streamingContent && (
            <div className="flex flex-col gap-1 items-start">
              <div className="max-w-[75%] rounded-2xl px-4 py-2.5 text-sm message-assistant">
                <div className="prose prose-sm prose-invert max-w-none">
                  <ReactMarkdown>{streamingContent}</ReactMarkdown>
                </div>
                <span className="streaming-cursor" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-[var(--border-color)] px-4 py-3 bg-[var(--bg-primary)]">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
              placeholder={activeChatId ? "Message… (⏎ send, ⇧⏎ newline)" : "Select or create a session first"}
              rows={1}
              className="flex-1 resize-none px-3.5 py-2.5 text-sm rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] transition-colors max-h-40 overflow-y-auto"
              style={{ minHeight: 40 }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 160) + "px";
              }}
            />
            <button
              onClick={sendMessage}
              disabled={isStreaming || !input.trim()}
              className="flex-shrink-0 p-2.5 rounded-xl bg-[var(--accent-color)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
