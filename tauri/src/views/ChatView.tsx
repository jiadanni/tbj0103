import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { Send, Plus, Trash2, Copy, ChevronDown, ArrowUpCircle, Pencil, RotateCcw, Check } from "lucide-react";
import { api, type AiModel } from "../lib/api";
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
  const [aiModelList, setAiModelList] = useState<AiModel[]>([]);
  const [lastUserMessage, setLastUserMessage] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

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

  // Load AI model priority list + fallback to raw Ollama models
  useEffect(() => {
    api.aiModel.list().then((models) => {
      setAiModelList(models);
      const enabled = models.filter((m) => m.enabled).sort((a, b) => a.priority - b.priority);
      if (enabled.length > 0) {
        const modelIds = enabled.map((m) => m.model_id);
        setAvailableModels(modelIds);
        if (!modelIds.includes(selectedModel)) {
          setSelectedModel(modelIds[0]);
        }
        return;
      }
      // Fallback to raw Ollama models
      api.ollama.listModels(ollamaUrl).then((m) => {
        if (m.length > 0) {
          const names = m.map((x) => x.name);
          setAvailableModels(names);
          if (!names.includes(selectedModel)) {
            setSelectedModel(names[0]);
          }
        }
      }).catch(() => {});
    }).catch(() => {
      // If ai_model list fails, fallback to Ollama
      api.ollama.listModels(ollamaUrl).then((m) => {
        if (m.length > 0) {
          const names = m.map((x) => x.name);
          setAvailableModels(names);
          if (!names.includes(selectedModel)) {
            setSelectedModel(names[0]);
          }
        }
      }).catch(() => {});
    });
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
    setLastUserMessage(userContent);

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
      const unlisten = await api.listenStream(sessionId, (chunk, done, tokensUsed) => {
        if (done) {
          finalizeStream(sessionId, selectedModel);
          setIsStreaming(false);
          unlisten();
          // Persist the assembled content with model and token info
          const assembled = useChatStore.getState().streamingContent;
          api.chat.addMessage(sessionId!, "assistant", assembled, selectedModel, tokensUsed).catch(() => {});
          if (tokensUsed && tokensUsed > 0) {
            api.aiModel.recordTokenUsage(selectedModel, tokensUsed).catch(() => {});
          }
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

  function copyMessage(msgId: string, content: string) {
    navigator.clipboard.writeText(content);
    setCopiedMessageId(msgId);
    setTimeout(() => setCopiedMessageId(null), 1500);
  }

  function startEditing(msgId: string, content: string) {
    setEditingMessageId(msgId);
    setEditContent(content);
  }

  async function submitEdit(msgId: string) {
    if (!activeChatId || !editContent.trim()) return;
    setEditingMessageId(null);
    // Find the index of the edited message, remove it and all following messages
    const idx = activeMessages.findIndex((m) => m.id === msgId);
    if (idx < 0) return;
    const trimmedMessages = activeMessages.slice(0, idx);
    setMessages(activeChatId, trimmedMessages);
    // Send the edited content as a new message
    setInput("");
    setIsStreaming(true);
    setLastUserMessage(editContent.trim());

    const userMsg = await api.chat.addMessage(activeChatId, "user", editContent.trim());
    appendMessage(activeChatId, userMsg);

    const history = trimmedMessages.map((m) => ({ role: m.role, content: m.content }));
    history.push({ role: "user", content: editContent.trim() });

    try {
      const sid = activeChatId;
      const unlisten = await api.listenStream(sid, (chunk, done, tokensUsed) => {
        if (done) {
          finalizeStream(sid, selectedModel);
          setIsStreaming(false);
          unlisten();
          const assembled = useChatStore.getState().streamingContent;
          api.chat.addMessage(sid, "assistant", assembled, selectedModel, tokensUsed).catch(() => {});
          if (tokensUsed && tokensUsed > 0) {
            api.aiModel.recordTokenUsage(selectedModel, tokensUsed).catch(() => {});
          }
        } else {
          appendStreamChunk(sid, chunk);
        }
      });
      await api.ollama.sendMessage(sid, selectedModel, history, true, ollamaUrl);
    } catch (err) {
      setIsStreaming(false);
      const errMsg = err instanceof Error ? err.message : String(err);
      appendStreamChunk(activeChatId, `\n\n⚠️ Error: ${errMsg}`);
      finalizeStream(activeChatId, selectedModel);
    }
  }

  async function redoMessage(msgId: string) {
    if (!activeChatId || isStreaming) return;
    // Find the assistant message, get the history up to just before it, and regenerate
    const idx = activeMessages.findIndex((m) => m.id === msgId);
    if (idx < 0) return;
    const trimmedMessages = activeMessages.slice(0, idx);
    setMessages(activeChatId, trimmedMessages);

    const history = trimmedMessages.map((m) => ({ role: m.role, content: m.content }));

    setIsStreaming(true);
    try {
      const sid = activeChatId;
      const unlisten = await api.listenStream(sid, (chunk, done, tokensUsed) => {
        if (done) {
          finalizeStream(sid, selectedModel);
          setIsStreaming(false);
          unlisten();
          const assembled = useChatStore.getState().streamingContent;
          api.chat.addMessage(sid, "assistant", assembled, selectedModel, tokensUsed).catch(() => {});
          if (tokensUsed && tokensUsed > 0) {
            api.aiModel.recordTokenUsage(selectedModel, tokensUsed).catch(() => {});
          }
        } else {
          appendStreamChunk(sid, chunk);
        }
      });
      await api.ollama.sendMessage(sid, selectedModel, history, true, ollamaUrl);
    } catch (err) {
      setIsStreaming(false);
      const errMsg = err instanceof Error ? err.message : String(err);
      appendStreamChunk(activeChatId, `\n\n⚠️ Error: ${errMsg}`);
      finalizeStream(activeChatId, selectedModel);
    }
  }

  const activeProject = projects.find((p) => p.id === activeProjectId);

  // Compute next-priority enabled model for "Try better model" button
  const enabledModels = aiModelList.filter((m) => m.enabled).sort((a, b) => a.priority - b.priority);
  const currentModelIdx = enabledModels.findIndex((m) => m.model_id === selectedModel);
  const nextModel = currentModelIdx >= 0 && currentModelIdx < enabledModels.length - 1 ? enabledModels[currentModelIdx + 1] : null;

  // Map model_id to display name from priority list
  const modelDisplayName = (modelId: string) => {
    const found = aiModelList.find((m) => m.model_id === modelId);
    return found ? found.name : modelId;
  };

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
              ? availableModels.map((m) => <option key={m} value={m}>{modelDisplayName(m)}</option>)
              : <option value={selectedModel}>{modelDisplayName(selectedModel)}</option>
            }
          </select>
          {nextModel && !isStreaming && activeMessages.length > 0 && (
            <button
              onClick={() => {
                setSelectedModel(nextModel.model_id);
                if (lastUserMessage) setInput(lastUserMessage);
              }}
              title={`Try ${nextModel.name}`}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--accent-color)] transition-colors"
            >
              <ArrowUpCircle size={12} />
              Try {nextModel.name}
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {activeMessages.map((msg) => (
            <div
              key={msg.id}
              className={`group/msg flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}
            >
              {editingMessageId === msg.id ? (
                <div className="max-w-[75%] w-full flex flex-col gap-2">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full resize-none px-3.5 py-2.5 text-sm rounded-xl bg-[var(--bg-elevated)] border border-[var(--accent-color)] text-[var(--text-primary)] outline-none max-h-40 overflow-y-auto"
                    rows={3}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitEdit(msg.id); }
                      if (e.key === "Escape") setEditingMessageId(null);
                    }}
                  />
                  <div className="flex gap-1.5 justify-end">
                    <button
                      onClick={() => setEditingMessageId(null)}
                      className="px-2.5 py-1 text-xs rounded-lg border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => submitEdit(msg.id)}
                      className="px-2.5 py-1 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 transition-opacity"
                    >
                      Send
                    </button>
                  </div>
                </div>
              ) : (
                <>
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
                  <div className={`flex gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                    <button
                      onClick={() => copyMessage(msg.id, msg.content)}
                      className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                      title="Copy"
                    >
                      {copiedMessageId === msg.id ? <Check size={11} /> : <Copy size={11} />}
                    </button>
                    {msg.role === "user" && !isStreaming && (
                      <button
                        onClick={() => startEditing(msg.id, msg.content)}
                        className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                        title="Edit"
                      >
                        <Pencil size={11} />
                      </button>
                    )}
                    {msg.role === "assistant" && !isStreaming && (
                      <button
                        onClick={() => redoMessage(msg.id)}
                        className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                        title="Redo"
                      >
                        <RotateCcw size={11} />
                      </button>
                    )}
                  </div>
                </>
              )}
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
