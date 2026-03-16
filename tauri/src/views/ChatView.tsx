import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { Send, Plus, Trash2, Copy, ChevronDown } from "lucide-react";
import { api } from "../lib/api";
import { useChatStore } from "../stores/chatStore";
import { useWorkspaceStore, type Project } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { ChatSession } from "../stores/chatStore";

export default function ChatView() {
  const { sessionId } = useParams();

  const {
    sessions, messages, activeChatId, setActiveChatId,
    setSessions, setMessages, appendMessage, appendStreamChunk, finalizeStream,
    streamingSessionId, streamingContent,
  } = useChatStore();

  const { activeProjectId, projects, setActiveProjectId } = useWorkspaceStore();
  const { preferredModel, ollamaUrl } = useSettingsStore();

  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedModel, setSelectedModel] = useState(preferredModel || "");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [showSessions, setShowSessions] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeMessages = activeChatId ? (messages[activeChatId] ?? []) : [];
  const isCurrentlyStreaming = streamingSessionId === activeChatId;

  // Load sessions (scoped to active project, or unscoped when none selected)
  useEffect(() => {
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

  // Load available models — auto-select if preferred model is not installed
  useEffect(() => {
    api.ollama.listModels(ollamaUrl).then((m) => {
      if (m.length > 0) {
        const names = m.map((x) => x.name);
        setAvailableModels(names);
        if (!names.includes(selectedModel)) {
          setSelectedModel(names[0]);
        }
      }
    }).catch(() => {});
  }, [ollamaUrl]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeMessages.length, streamingContent]);

  async function createNewSession() {
    const session = await api.chat.createSession(activeProjectId, { modelName: selectedModel });
    useChatStore.getState().addSession(session);
    setActiveChatId(session.id);
    setMessages(session.id, []);
  }

  async function sendMessage() {
    if (!input.trim() || isStreaming || !selectedModel) return;

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

  const activeProject = projects.find((p) => p.id === activeProjectId);

  // ── State 1: No project selected ──────────────────────────────────────────
  if (!activeProjectId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
        <p className="text-[var(--text-muted)] text-sm font-medium">Select a project to start chatting</p>
        {projects.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">No projects yet — create one from the sidebar.</p>
        ) : (
          <div className="flex flex-col gap-2 w-64">
            {projects.map((p: Project) => (
              <button
                key={p.id}
                onClick={() => setActiveProjectId(p.id)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] hover:border-[var(--accent-color)] text-[var(--text-primary)] text-sm transition-colors"
              >
                {p.icon && <span>{p.icon}</span>}
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── State 2: Project selected, no active chat (conversations list) ────────
  if (!activeChatId) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">{activeProject?.name ?? "Chat"}</h2>
            {activeProject?.project_description && (
              <p className="text-xs text-[var(--text-muted)] mt-0.5">{activeProject.project_description}</p>
            )}
          </div>
          <button
            onClick={createNewSession}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent-color)] text-white text-xs hover:opacity-90 transition-opacity"
          >
            <Plus size={13} /> New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <p className="text-[var(--text-muted)] text-sm">No conversations yet</p>
              <button
                onClick={createNewSession}
                className="px-4 py-2 bg-[var(--accent-color)] text-white rounded-lg text-sm hover:opacity-90"
              >
                Start a new chat
              </button>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-color)]">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => setActiveChatId(s.id)}
                  className="group flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--text-primary)] truncate">{s.title || "New Chat"}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">{s.model_name}</p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:text-red-400 text-[var(--text-muted)] transition-all"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── State 3: Active session — side panel + chat ───────────────────────────
  return (
    <div className="flex h-full overflow-hidden">
      {/* Conversations side panel */}
      <div className="w-52 border-r border-[var(--border-color)] flex flex-col bg-[var(--bg-sidebar)] overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-color)]">
          <button
            onClick={() => setActiveChatId(null)}
            className="text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] truncate transition-colors"
            title="Back to conversations"
          >
            {activeProject?.name ?? "Conversations"}
          </button>
          <button
            onClick={createNewSession}
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="New chat"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
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
          {availableModels.length === 0 && (
            <span className="text-xs text-amber-400">No Ollama models found</span>
          )}
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
              placeholder={isStreaming ? "Waiting for response…" : !selectedModel ? "No models available — install one via ollama pull" : "Message… (⏎ send, ⇧⏎ newline)"}
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
              disabled={isStreaming || !input.trim() || !selectedModel}
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
