import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, Plus, Trash2, Copy, ChevronDown, ArrowUpCircle, Pencil, RotateCcw, Check, Search, Pin, PinOff, MessageSquare, SplitSquareHorizontal, RefreshCw, BookOpen, FileText, ChevronUp, Zap, Inbox, Clock, CheckCircle2, Loader2, X, Globe } from "lucide-react";
import { api, type AiModel, type OllamaModel, type SearchResult, type ThoughtItem } from "../lib/api";
import { useChatStore } from "../stores/chatStore";
import { useWorkspaceStore, type Project } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { ChatSession } from "../stores/chatStore";

type ChatMode = "chat" | "compare";

export default function ChatView() {
  const { sessionId } = useParams();

  const {
    sessions, messages, activeChatId, setActiveChatId,
    setSessions, setMessages, appendMessage, appendStreamChunk, finalizeStream,
    streamingSessionId, streamingContent, setStreamingSession, updateMessage,
  } = useChatStore();

  const { activeProjectId, projects, setActiveProjectId, activeWorkspaceId } = useWorkspaceStore();
  const { preferredModel, ollamaUrl, dualModelEnabled, draftModel, setDualModelEnabled, setDraftModel } = useSettingsStore();

  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedModel, setSelectedModel] = useState(preferredModel || "");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [aiModelList, setAiModelList] = useState<AiModel[]>([]);
  const [lastUserMessage, setLastUserMessage] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  // Chat mode: normal chat vs model comparison
  const [chatMode, setChatMode] = useState<ChatMode>("chat");

  // Session list features (merged from ChatSessionListView)
  const [sessionQuery, setSessionQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");

  // Model comparison state
  const [compareModelA, setCompareModelA] = useState("");
  const [compareModelB, setCompareModelB] = useState("");
  const [comparePrompt, setComparePrompt] = useState("");
  const [compareResponseA, setCompareResponseA] = useState("");
  const [compareResponseB, setCompareResponseB] = useState("");
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareModels, setCompareModels] = useState<OllamaModel[]>([]);

  // Grounded chat (RAG) state
  const [groundedEnabled, setGroundedEnabled] = useState(false);
  const [groundedTopK, setGroundedTopK] = useState(5);
  const [processedDocCount, setProcessedDocCount] = useState(0);
  const [messageSources, setMessageSources] = useState<Record<string, SearchResult[]>>({});
  const [expandedSources, setExpandedSources] = useState<string | null>(null);

  // Per-message metadata (tok/s and duration) persisted on the Message itself;
  // no in-memory state needed — loaded from DB on session open.;

  // ── Thought Queue panel ────────────────────────────────────────────────
  const [thoughtPanelOpen, setThoughtPanelOpen] = useState(false);
  const [thoughts, setThoughts] = useState<ThoughtItem[]>([]);
  const [thoughtDraft, setThoughtDraft] = useState("");
  const [thoughtSchedule, setThoughtSchedule] = useState("");
  const [thoughtScheduleEnabled, setThoughtScheduleEnabled] = useState(false);
  const [thoughtSubmitting, setThoughtSubmitting] = useState(false);
  const [thoughtExpandedId, setThoughtExpandedId] = useState<string | null>(null);
  const thoughtProcessingRef = useRef<Set<string>>(new Set());

  const loadThoughts = useCallback(async () => {
    if (!activeWorkspaceId) return;
    try {
      const items = await api.thoughtQueue.list(activeWorkspaceId);
      setThoughts(items);
    } catch { /* ignore */ }
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!thoughtPanelOpen) return;
    loadThoughts();
  }, [thoughtPanelOpen, loadThoughts]);

  const processDueThought = useCallback(async (thought: ThoughtItem) => {
    if (thoughtProcessingRef.current.has(thought.id)) return;
    thoughtProcessingRef.current.add(thought.id);
    try {
      await api.thoughtQueue.updateStatus(thought.id, "processing");
      setThoughts((prev) => prev.map((t) => t.id === thought.id ? { ...t, status: "processing" } : t));
      const userContent = thought.prompt_prefix.trim()
        ? `${thought.prompt_prefix}\n\n${thought.content}`
        : thought.content;
      const result = await api.ollama.sendMessage(thought.id, thought.model_name, [{ role: "user", content: userContent }], false, ollamaUrl);
      await api.thoughtQueue.updateResult(thought.id, result);
      setThoughts((prev) => prev.map((t) => t.id === thought.id ? { ...t, status: "done", result, result_at: new Date().toISOString() } : t));
      setThoughtExpandedId(thought.id);
    } catch {
      await api.thoughtQueue.updateStatus(thought.id, "scheduled").catch(() => {});
      setThoughts((prev) => prev.map((t) => t.id === thought.id ? { ...t, status: "scheduled" } : t));
    } finally {
      thoughtProcessingRef.current.delete(thought.id);
    }
  }, [ollamaUrl]);

  useEffect(() => {
    if (!activeWorkspaceId || !thoughtPanelOpen) return;
    async function pollDue() {
      if (!activeWorkspaceId) return;
      try {
        const due = await api.thoughtQueue.getDue(activeWorkspaceId);
        for (const t of due) processDueThought(t);
      } catch { /* ignore */ }
    }
    pollDue();
    const timer = setInterval(pollDue, 60_000);
    return () => clearInterval(timer);
  }, [activeWorkspaceId, thoughtPanelOpen, processDueThought]);

  async function submitThought() {
    if (!activeWorkspaceId || !thoughtDraft.trim()) return;
    setThoughtSubmitting(true);
    try {
      const processAt = thoughtScheduleEnabled && thoughtSchedule ? new Date(thoughtSchedule).toISOString() : undefined;
      const item = await api.thoughtQueue.create(activeWorkspaceId, thoughtDraft.trim(), {
        processAt, modelName: selectedModel || undefined,
      });
      setThoughts((prev) => [item, ...prev]);
      setThoughtDraft("");
      setThoughtScheduleEnabled(false);
    } finally {
      setThoughtSubmitting(false);
    }
  } 

  // Web AI session settings
  const [preserveWebSession, setPreserveWebSession] = useState(false);

  useEffect(() => {
    api.settings.get().then((s) => setPreserveWebSession(s.web_session_preserve)).catch(() => {});
  }, []);

  // Dual-model (draft + refine) state
  const [isRefiningPhase, setIsRefiningPhase] = useState(false);
  const [draftSnapshot, setDraftSnapshot] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeMessages = activeChatId ? (messages[activeChatId] ?? []) : [];
  const isCurrentlyStreaming = streamingSessionId === activeChatId;

  // Web AI provider detection
  const selectedModelMeta = aiModelList.find((m) => m.model_id === selectedModel);
  const isWebProvider = selectedModelMeta?.provider.startsWith("web_") ?? false;
  const webProviderKey = isWebProvider ? selectedModelMeta!.provider.replace("web_", "") : "";
  const webProviderLabel: Record<string, string> = {
    chatgpt: "ChatGPT", deepseek: "DeepSeek", claude: "Claude", gemini: "Gemini",
  };

  // Filter + sort sessions: pinned first, then by date
  const filteredSessions = sessions.filter(
    (s) =>
      s.title.toLowerCase().includes(sessionQuery.toLowerCase()) ||
      s.model_name.toLowerCase().includes(sessionQuery.toLowerCase())
  );
  const pinnedSessions = filteredSessions.filter((s) => s.is_pinned);
  const unpinnedSessions = filteredSessions.filter((s) => !s.is_pinned);

  // Load processed doc count for grounded chat indicator
  useEffect(() => {
    if (!activeProjectId) { setProcessedDocCount(0); return; }
    api.document.list(activeProjectId).then((docs) => {
      setProcessedDocCount(docs.filter((d) => d.is_processed).length);
    }).catch(() => setProcessedDocCount(0));
  }, [activeProjectId]);

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

  async function generateSessionTitleIfNeeded(sessionId: string, model: string, firstMessage: string) {
    const settings = await api.settings.get().catch(() => null);
    if (!settings || settings.chat_title_auto_refresh === "disabled") return;

    const session = useChatStore.getState().sessions.find(s => s.id === sessionId);
    if (!session) return;

    const sessionMessages = useChatStore.getState().messages[sessionId] ?? [];
    const userMessageCount = sessionMessages.filter(m => m.role === "user").length;
    const isFirstMessage = userMessageCount <= 1;

    // Initial title generation on first message
    if (isFirstMessage) {
      try {
        const title = await api.ollama.generateTitle(model, firstMessage, ollamaUrl);
        // Persist to DB
        await api.chat.updateSession(sessionId, { title });
        // Update local store
        useChatStore.getState().updateSession({
          ...session,
          title,
          title_generated_at: new Date().toISOString(),
          message_count_at_title_gen: 1
        });
      } catch {
        // Silently fail if title generation errors
      }
      return;
    }

    // Periodic title refresh — only in "periodic" mode, skip if "initial_only"
    if (settings.chat_title_auto_refresh === "periodic") {
      const lastTitleGenCount = session.message_count_at_title_gen ?? 0;
      const interval = settings.chat_title_refresh_interval || 5;

      if (userMessageCount - lastTitleGenCount >= interval) {
        try {
          // Send conversation context for a better title
          const conversation = sessionMessages.map(m => ({ role: m.role, content: m.content }));
          const title = await api.ollama.generateTitleFromConversation(model, conversation, ollamaUrl);
          // Persist to DB
          await api.chat.updateSession(sessionId, { title });
          // Update local store
          useChatStore.getState().updateSession({
            ...session,
            title,
            title_generated_at: new Date().toISOString(),
            message_count_at_title_gen: userMessageCount
          });
        } catch {
          // Silently fail if title generation errors
        }
      }
    }
  }

  async function sendMessage() {
    if (!input.trim() || isStreaming || !selectedModel) return;

    let sid = activeChatId;
    if (!sid) {
      const session = await api.chat.createSession(activeProjectId, { modelName: selectedModel });
      useChatStore.getState().addSession(session);
      sid = session.id;
      setActiveChatId(session.id);
      setMessages(session.id, []);
    }

    const userContent = input.trim();
    setInput("");
    setIsStreaming(true);
    setLastUserMessage(userContent);

    // Persist user message
    const userMsg = await api.chat.addMessage(sid, "user", userContent);
    appendMessage(sid, userMsg);

    // Build context for Ollama
    const history = (messages[sid] ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // If grounded mode is on, retrieve document context and augment the prompt
    let finalUserContent = userContent;
    if (groundedEnabled && activeProjectId) {
      try {
        const keywordResults = await api.search.keyword(userContent, activeProjectId, undefined);
        const chunkResults = keywordResults.filter((r) => r.result_type === "document_chunk").slice(0, groundedTopK);
        if (chunkResults.length > 0) {
          const contextParts = chunkResults.map((r, i) => `[${i + 1}] **${r.title}**: ${r.excerpt}`);
          finalUserContent =
            `You have access to the following document excerpts:\n\n` +
            contextParts.join("\n\n") +
            `\n\nUsing the above context where relevant, answer: ${userContent}\n\n` +
            `Cite sources as [1], [2], etc. when referencing specific content.`;
          // Store sources keyed by the user message ID so we can show them
          setMessageSources((prev) => ({ ...prev, [userMsg.id]: chunkResults }));
        }
      } catch {
        // If search fails, just send without grounding
      }
    }

    history.push({ role: "user", content: finalUserContent });

    if (isWebProvider && webProviderKey) {
      // ── Web AI (Playwright) path ───────────────────────────────────────────
      try {
        const unlisten = await api.listenStream(sid, (chunk, done) => {
          if (done) {
            const assembled = useChatStore.getState().streamingContent;
            finalizeStream(sid!, selectedModel);
            setIsStreaming(false);
            unlisten();
            api.chat.addMessage(sid!, "assistant", assembled, selectedModel)
              .then((persisted) => updateMessage(sid!, persisted))
              .catch(() => {});
          } else {
            appendStreamChunk(sid!, chunk);
          }
        });
        await api.webAI.sendMessage(sid, webProviderKey, finalUserContent, preserveWebSession);
      } catch (err) {
        setIsStreaming(false);
        const errMsg = err instanceof Error ? err.message : String(err);
        appendStreamChunk(sid, `\n\n⚠️ Error: ${errMsg}`);
        finalizeStream(sid, selectedModel);
      }
    } else if (dualModelEnabled && draftModel && draftModel !== selectedModel) {
      // ── Dual-model path: draft first (small model), then refine (large model) ──
      setIsRefiningPhase(false);
      try {
        let draftUnlisten: (() => void) | null = null;
        draftUnlisten = await api.listenStream(sid!, (chunk, done) => {
          if (done) {
            // Snapshot the draft BEFORE clearing the streaming state
            const draftText = useChatStore.getState().streamingContent;
            setDraftSnapshot(draftText);
            setStreamingSession(null); // clear streaming bubble without finalizing
            setIsRefiningPhase(true);
            draftUnlisten?.();
          } else {
            appendStreamChunk(sid!, chunk);
          }
        });

        let refineUnlisten: (() => void) | null = null;
        refineUnlisten = await api.listenRefineStream(sid!, (chunk, done, tokensUsed, durationMs) => {
          if (done) {
            const refineText = useChatStore.getState().streamingContent;
            finalizeStream(sid!, selectedModel);
            setIsRefiningPhase(false);
            setDraftSnapshot("");
            setIsStreaming(false);
            refineUnlisten?.();
            api.chat.addMessage(sid!, "assistant", refineText, selectedModel, tokensUsed, durationMs)
              .then((persisted) => updateMessage(sid!, persisted))
              .catch(() => {});
            if (tokensUsed && tokensUsed > 0) {
              api.aiModel.recordTokenUsage(selectedModel, tokensUsed).catch(() => {});
            }
          } else {
            appendStreamChunk(sid!, chunk);
          }
        });

        await api.ollama.sendDualModelMessage(sid!, draftModel, selectedModel, history, ollamaUrl);
      } catch (err) {
        setIsStreaming(false);
        setIsRefiningPhase(false);
        setDraftSnapshot("");
        const errMsg = err instanceof Error ? err.message : String(err);
        appendStreamChunk(sid!, `\n\n⚠️ Error: ${errMsg}`);
        finalizeStream(sid!, selectedModel);
      }
    } else {
      // ── Normal single-model path ──
      try {
        const unlisten = await api.listenStream(sid, (chunk, done, tokensUsed, durationMs) => {
          if (done) {
            const assembled = useChatStore.getState().streamingContent;
            finalizeStream(sid!, selectedModel);
            setIsStreaming(false);
            unlisten();
            api.chat.addMessage(sid!, "assistant", assembled, selectedModel, tokensUsed, durationMs)
              .then((persisted) => updateMessage(sid!, persisted))
              .catch(() => {});
            if (tokensUsed && tokensUsed > 0) {
              api.aiModel.recordTokenUsage(selectedModel, tokensUsed).catch(() => {});
            }
          } else {
            appendStreamChunk(sid!, chunk);
          }
        });

        await api.ollama.sendMessage(sid, selectedModel, history, true, ollamaUrl);
      } catch (err) {
        setIsStreaming(false);
        const errMsg = err instanceof Error ? err.message : String(err);
        appendStreamChunk(sid, `\n\n⚠️ Error: ${errMsg}`);
        finalizeStream(sid, selectedModel);
      }
    }

    // Auto-generate title based on settings
    await generateSessionTitleIfNeeded(sid, selectedModel, userContent);
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

  async function togglePin(session: ChatSession) {
    await api.chat.updateSession(session.id, { is_pinned: !session.is_pinned });
    setSessions(
      sessions.map((s) =>
        s.id === session.id ? { ...s, is_pinned: !s.is_pinned } : s
      )
    );
  }

  async function renameSession(id: string) {
    if (!renameTitle.trim()) { setRenamingId(null); return; }
    await api.chat.updateSession(id, { title: renameTitle });
    setSessions(sessions.map((s) => s.id === id ? { ...s, title: renameTitle } : s));
    setRenamingId(null);
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
    const idx = activeMessages.findIndex((m) => m.id === msgId);
    if (idx < 0) return;
    const trimmedMessages = activeMessages.slice(0, idx);
    setMessages(activeChatId, trimmedMessages);
    setInput("");
    setIsStreaming(true);
    setLastUserMessage(editContent.trim());

    const userMsg = await api.chat.addMessage(activeChatId, "user", editContent.trim());
    appendMessage(activeChatId, userMsg);

    const history = trimmedMessages.map((m) => ({ role: m.role, content: m.content }));
    history.push({ role: "user", content: editContent.trim() });

    try {
      const sid = activeChatId;
      const unlisten = await api.listenStream(sid, (chunk, done, tokensUsed, durationMs) => {
        if (done) {
          finalizeStream(sid, selectedModel);
          setIsStreaming(false);
          unlisten();
          const assembled = useChatStore.getState().streamingContent;
          api.chat.addMessage(sid, "assistant", assembled, selectedModel, tokensUsed, durationMs)
            .then((persisted) => updateMessage(sid, persisted))
            .catch(() => {});
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
    const idx = activeMessages.findIndex((m) => m.id === msgId);
    if (idx < 0) return;
    const trimmedMessages = activeMessages.slice(0, idx);
    setMessages(activeChatId, trimmedMessages);

    const history = trimmedMessages.map((m) => ({ role: m.role, content: m.content }));

    setIsStreaming(true);
    try {
      const sid = activeChatId;
      const unlisten = await api.listenStream(sid, (chunk, done, tokensUsed, durationMs) => {
        if (done) {
          finalizeStream(sid, selectedModel);
          setIsStreaming(false);
          unlisten();
          const assembled = useChatStore.getState().streamingContent;
          api.chat.addMessage(sid, "assistant", assembled, selectedModel, tokensUsed, durationMs)
            .then((persisted) => updateMessage(sid, persisted))
            .catch(() => {});
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

  // Load models for comparison mode
  useEffect(() => {
    if (chatMode !== "compare") return;
    api.ollama.listModels(ollamaUrl || undefined).then((list) => {
      setCompareModels(list);
      if (list.length > 0 && !compareModelA) setCompareModelA(list[0].name);
      if (list.length > 1 && !compareModelB) setCompareModelB(list[1].name);
      else if (list.length === 1 && !compareModelB) setCompareModelB(list[0].name);
    }).catch(() => {});
  }, [chatMode, ollamaUrl]);

  async function runComparison() {
    if (!comparePrompt.trim() || compareLoading) return;
    const p = comparePrompt.trim();
    setComparePrompt("");
    setCompareResponseA("");
    setCompareResponseB("");
    setCompareError(null);
    setCompareLoading(true);
    try {
      const msgs = [{ role: "user", content: p }];
      const [resA, resB] = await Promise.all([
        api.ollama.sendMessage("compare-a", compareModelA, msgs, false, ollamaUrl || undefined),
        api.ollama.sendMessage("compare-b", compareModelB, msgs, false, ollamaUrl || undefined),
      ]);
      setCompareResponseA(resA);
      setCompareResponseB(resB);
    } catch (err: any) {
      setCompareError(err?.message ?? String(err));
    } finally {
      setCompareLoading(false);
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

  // ── Session sidebar (always visible) ─────────────────────────────────────
  function SessionSidebar() {
    return (
      <div className="w-56 border-r border-[var(--border-color)] flex flex-col bg-[var(--bg-sidebar)] overflow-hidden shrink-0">
        {/* Mode toggle */}
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border-color)]">
          <button
            onClick={() => setChatMode("chat")}
            className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[11px] rounded transition-colors ${
              chatMode === "chat"
                ? "bg-[var(--accent-color)] text-white font-medium"
                : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            <MessageSquare size={11} /> Chat
          </button>
          <button
            onClick={() => setChatMode("compare")}
            className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[11px] rounded transition-colors ${
              chatMode === "compare"
                ? "bg-[var(--accent-color)] text-white font-medium"
                : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            <SplitSquareHorizontal size={11} /> Compare
          </button>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-color)]">
          <span className="text-xs font-medium text-[var(--text-secondary)] truncate">
            {activeProject?.name ?? "Conversations"}
          </span>
          <button
            onClick={createNewSession}
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="New chat"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Search */}
        <div className="px-2 py-1.5 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-1.5 bg-[var(--bg-elevated)] rounded-lg px-2 py-1">
            <Search size={11} className="text-[var(--text-muted)]" />
            <input
              value={sessionQuery}
              onChange={(e) => setSessionQuery(e.target.value)}
              placeholder="Search…"
              className="flex-1 text-[11px] bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
            />
          </div>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto">
          {filteredSessions.length === 0 && sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-3">
              <MessageSquare size={20} className="text-[var(--text-muted)] opacity-30" />
              <p className="text-[11px] text-[var(--text-muted)]">No conversations yet</p>
            </div>
          ) : filteredSessions.length === 0 ? (
            <p className="px-3 py-4 text-[11px] text-[var(--text-muted)] text-center">No matches</p>
          ) : (
            <>
              {pinnedSessions.length > 0 && (
                <>
                  <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-sidebar)]">
                    Pinned
                  </div>
                  {pinnedSessions.map((s) => <SessionItem key={s.id} session={s} />)}
                </>
              )}
              {unpinnedSessions.length > 0 && (
                <>
                  {pinnedSessions.length > 0 && (
                    <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-sidebar)]">
                      All
                    </div>
                  )}
                  {unpinnedSessions.map((s) => <SessionItem key={s.id} session={s} />)}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer stats */}
        {sessions.length > 0 && (
          <div className="px-3 py-1.5 border-t border-[var(--border-color)] shrink-0">
            <p className="text-[10px] text-[var(--text-muted)]">
              {sessions.length} session{sessions.length !== 1 ? "s" : ""}{pinnedSessions.length > 0 ? ` · ${pinnedSessions.length} pinned` : ""}
            </p>
          </div>
        )}
      </div>
    );
  }

  function SessionItem({ session }: { session: ChatSession }) {
    const isActive = activeChatId === session.id;
    const isRenaming = renamingId === session.id;

    return (
      <div
        onClick={() => setActiveChatId(session.id)}
        className={`group flex items-center gap-1 px-3 py-2 cursor-pointer transition-colors ${
          isActive
            ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        }`}
      >
        {isRenaming ? (
          <input
            autoFocus
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") renameSession(session.id);
              if (e.key === "Escape") setRenamingId(null);
            }}
            onBlur={() => renameSession(session.id)}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 text-[11px] bg-[var(--bg-elevated)] border border-[var(--accent-color)] rounded px-1.5 py-0.5 text-[var(--text-primary)] outline-none"
          />
        ) : (
          <span className="flex-1 text-xs truncate">{session.title || "New Chat"}</span>
        )}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {!isRenaming && (
            <button
              onClick={(e) => { e.stopPropagation(); setRenamingId(session.id); setRenameTitle(session.title); }}
              className="p-0.5 rounded hover:text-[var(--accent-color)] transition-colors text-[10px]"
              title="Rename"
            >
              <Pencil size={10} />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); togglePin(session); }}
            className="p-0.5 rounded hover:text-[var(--accent-color)] transition-colors"
            title={session.is_pinned ? "Unpin" : "Pin"}
          >
            {session.is_pinned ? <PinOff size={10} /> : <Pin size={10} />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
            className="p-0.5 rounded hover:text-red-400 transition-colors"
          >
            <Trash2 size={10} />
          </button>
        </div>
      </div>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden">
      <SessionSidebar />

      {/* Compare mode */}
      {chatMode === "compare" ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Model selectors header */}
          <div className="flex items-stretch border-b border-[var(--border-color)] flex-shrink-0 bg-[var(--bg-elevated)]">
            <div className="flex-1 px-4 py-3 flex flex-col gap-1 border-r border-[var(--border-color)]">
              <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Model A</label>
              {compareModels.length === 0 ? (
                <input value={compareModelA} onChange={(e) => setCompareModelA(e.target.value)} placeholder="e.g. qwen2.5:7b" className="text-sm bg-transparent border-b border-[var(--border-color)] text-[var(--text-primary)] outline-none py-0.5 w-full placeholder:text-[var(--text-muted)]" />
              ) : (
                <select value={compareModelA} onChange={(e) => setCompareModelA(e.target.value)} className="text-sm bg-transparent text-[var(--text-primary)] outline-none py-0.5 w-full cursor-pointer">
                  {compareModels.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                </select>
              )}
            </div>
            <div className="flex items-center px-3">
              <button onClick={() => api.ollama.listModels(ollamaUrl || undefined).then(setCompareModels).catch(() => {})} title="Refresh models" className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors">
                <RefreshCw size={14} />
              </button>
            </div>
            <div className="flex-1 px-4 py-3 flex flex-col gap-1 border-l border-[var(--border-color)]">
              <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Model B</label>
              {compareModels.length === 0 ? (
                <input value={compareModelB} onChange={(e) => setCompareModelB(e.target.value)} placeholder="e.g. llama3:8b" className="text-sm bg-transparent border-b border-[var(--border-color)] text-[var(--text-primary)] outline-none py-0.5 w-full placeholder:text-[var(--text-muted)]" />
              ) : (
                <select value={compareModelB} onChange={(e) => setCompareModelB(e.target.value)} className="text-sm bg-transparent text-[var(--text-primary)] outline-none py-0.5 w-full cursor-pointer">
                  {compareModels.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                </select>
              )}
            </div>
          </div>

          {/* Side-by-side responses */}
          <div className="flex flex-1 overflow-hidden divide-x divide-[var(--border-color)]">
            {[{ label: "Model A", model: compareModelA, text: compareResponseA }, { label: "Model B", model: compareModelB, text: compareResponseB }].map((panel) => (
              <div key={panel.label} className="flex-1 flex flex-col overflow-hidden">
                <div className="px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-elevated)] flex-shrink-0">
                  <span className="text-xs font-medium text-[var(--text-primary)]">{panel.label}</span>
                  {panel.model && <span className="ml-2 text-xs text-[var(--text-muted)]">{panel.model}</span>}
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-4">
                  {compareLoading && !panel.text ? (
                    <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm"><span className="animate-pulse">●</span> Generating…</div>
                  ) : panel.text ? (
                    <pre className="text-sm text-[var(--text-primary)] whitespace-pre-wrap font-[inherit] leading-relaxed">{panel.text}</pre>
                  ) : (
                    <p className="text-sm text-[var(--text-muted)] italic">Response will appear here…</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {compareError && (
            <div className="px-4 py-2 text-xs text-red-400 bg-red-500/10 border-t border-red-500/20 flex-shrink-0">{compareError}</div>
          )}

          {/* Compare input */}
          <div className="border-t border-[var(--border-color)] px-4 py-3 flex gap-3 items-end flex-shrink-0">
            <textarea
              rows={2}
              value={comparePrompt}
              onChange={(e) => setComparePrompt(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); runComparison(); } }}
              placeholder="Enter prompt to compare… (⌘↵ to send)"
              className="flex-1 resize-none px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] min-h-[40px] max-h-[120px]"
            />
            <button
              onClick={runComparison}
              disabled={!comparePrompt.trim() || compareLoading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-white bg-[var(--accent-color)] hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              <Send size={14} /> {compareLoading ? "Running…" : "Compare"}
            </button>
          </div>
        </div>
      ) : !activeChatId ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
          <MessageSquare size={40} className="text-[var(--text-muted)] opacity-30" />
          <p className="text-[var(--text-muted)] text-sm">Select a conversation or start a new one</p>
          <button
            onClick={createNewSession}
            className="px-4 py-2 bg-[var(--accent-color)] text-white rounded-lg text-sm hover:opacity-90"
          >
            Start a new chat
          </button>
        </div>
      ) : (
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
            {/* Dual-model toggle */}
            <button
              onClick={() => setDualModelEnabled(!dualModelEnabled)}
              title={dualModelEnabled ? `Dual model ON — draft: ${draftModel || "(none)"} → refine: ${selectedModel}` : "Enable dual-model mode (draft + refine)"}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors ${
                dualModelEnabled
                  ? "bg-amber-500/15 border-amber-500/50 text-amber-400"
                  : "bg-[var(--bg-elevated)] border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              <Zap size={12} />
              {dualModelEnabled && <span className="text-[10px] hidden sm:inline">Draft</span>}
            </button>
            {dualModelEnabled && (
              <select
                value={draftModel}
                onChange={(e) => setDraftModel(e.target.value)}
                title="Draft model (small/fast)"
                className="text-xs px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 outline-none max-w-[120px]"
              >
                <option value="">Draft model…</option>
                {availableModels.map((m) => (
                  <option key={m} value={m}>{modelDisplayName(m)}</option>
                ))}
              </select>
            )}
            {/* Grounded (RAG) toggle */}
            <button
              onClick={() => setGroundedEnabled((v) => !v)}
              title={groundedEnabled ? `Grounded mode ON (${processedDocCount} docs)` : "Enable grounded mode (RAG)"}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors ${
                groundedEnabled
                  ? "bg-[var(--accent-color)]/15 border-[var(--accent-color)] text-[var(--accent-color)]"
                  : "bg-[var(--bg-elevated)] border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              <BookOpen size={12} />
              {groundedEnabled && processedDocCount > 0 && (
                <span className="text-[10px]">{processedDocCount}</span>
              )}
            </button>
            {groundedEnabled && (
              <select
                value={groundedTopK}
                onChange={(e) => setGroundedTopK(Number(e.target.value))}
                className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-secondary)] outline-none"
                title="Number of document chunks to retrieve"
              >
                {[3, 5, 8, 10].map((v) => <option key={v} value={v}>Top {v}</option>)}
              </select>
            )}
            {/* Thought queue toggle */}
            <button
              onClick={() => setThoughtPanelOpen((v) => !v)}
              title="Thought Queue"
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors ${
                thoughtPanelOpen
                  ? "bg-[var(--accent-color)]/15 border-[var(--accent-color)] text-[var(--accent-color)]"
                  : "bg-[var(--bg-elevated)] border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              <Inbox size={12} />
              {thoughts.filter((t) => t.status === "scheduled" || t.status === "processing").length > 0 && (
                <span className="text-[10px]">{thoughts.filter((t) => t.status === "scheduled" || t.status === "processing").length}</span>
              )}
            </button>
          </div>

          {/* Web AI provider notice */}
          {isWebProvider && webProviderKey && (
            <div className="mx-4 mt-2 px-3 py-1.5 rounded bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-400 flex items-center gap-1.5">
              <Globe size={12} />
              A browser window will open — log in to {webProviderLabel[webProviderKey] ?? webProviderKey} and your query will be submitted automatically.
              {!preserveWebSession && (
                <span className="ml-auto text-[10px] opacity-60">Session cleared after query</span>
              )}
            </div>
          )}

          {/* Grounded mode warning if no processed docs */}
          {groundedEnabled && processedDocCount === 0 && activeProjectId && (
            <div className="mx-4 mt-2 px-3 py-1.5 rounded bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-500 flex items-center gap-1.5">
              <FileText size={12} />
              No processed documents. Upload and process docs in the Document Browser.
            </div>
          )}

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
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
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
                    {/* Token count + duration + tok/s */}
                    {msg.role === "assistant" && (msg.tokens_used || msg.duration_ms) && (
                      <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] tabular-nums">
                        {msg.tokens_used && (
                          <span>{msg.tokens_used.toLocaleString()} tok</span>
                        )}
                        {msg.duration_ms && (
                          <span>
                            {msg.duration_ms >= 1000
                              ? `${(msg.duration_ms / 1000).toFixed(1)}s`
                              : `${msg.duration_ms}ms`}
                          </span>
                        )}
                        {msg.tokens_used && msg.duration_ms && msg.duration_ms > 0 && (
                          <span className="text-[var(--accent-color)] font-medium">
                            {(msg.tokens_used / (msg.duration_ms / 1000)).toFixed(1)} tok/s
                          </span>
                        )}
                      </div>
                    )}
                    {/* Grounded sources for this message */}
                    {messageSources[msg.id] && messageSources[msg.id].length > 0 && (
                      <div className={`max-w-[75%] ${msg.role === "user" ? "self-end" : ""}`}>
                        <button
                          onClick={() => setExpandedSources(expandedSources === msg.id ? null : msg.id)}
                          className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                        >
                          <BookOpen size={10} />
                          {messageSources[msg.id].length} source{messageSources[msg.id].length !== 1 ? "s" : ""} used
                          {expandedSources === msg.id ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                        </button>
                        {expandedSources === msg.id && (
                          <div className="mt-1.5 space-y-1">
                            {messageSources[msg.id].map((s, i) => (
                              <div key={s.id} className="rounded-lg p-2 bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[11px]">
                                <div className="font-medium text-[var(--text-secondary)]">[{i + 1}] {s.title}</div>
                                <div className="text-[var(--text-muted)] line-clamp-2 mt-0.5">{s.excerpt}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}

            {/* Draft snapshot bubble — shown during refine phase */}
            {isRefiningPhase && draftSnapshot && (
              <div className="flex flex-col gap-1 items-start">
                <div className="max-w-[75%] rounded-2xl px-4 py-2.5 text-sm message-assistant opacity-60 border border-amber-500/20">
                  <div className="flex items-center gap-1 mb-1 text-[10px] text-amber-400">
                    <Zap size={9} /> Draft ({draftModel})
                  </div>
                  <div className="prose prose-sm prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{draftSnapshot}</ReactMarkdown>
                  </div>
                </div>
              </div>
            )}

            {/* Refining indicator — between draft done and first refine chunk */}
            {isRefiningPhase && !isCurrentlyStreaming && (
              <div className="flex items-center gap-2 text-xs text-amber-400 px-1">
                <Zap size={11} className="animate-pulse" />
                <span className="animate-pulse">Refining with {selectedModel}…</span>
              </div>
            )}

            {/* Thinking indicator — spinner shown before the first token arrives */}
            {isStreaming && !isCurrentlyStreaming && !isRefiningPhase && (
              <div className="flex flex-col gap-1 items-start">
                <div className="flex items-center gap-2.5 max-w-[75%] rounded-2xl px-4 py-3 text-sm message-assistant">
                  <span className="flex gap-1 items-center">
                    <span
                      className="inline-block w-2 h-2 rounded-full bg-[var(--accent-color)] opacity-80"
                      style={{ animation: "thinking-dot 1.2s ease-in-out infinite" }}
                    />
                    <span
                      className="inline-block w-2 h-2 rounded-full bg-[var(--accent-color)] opacity-80"
                      style={{ animation: "thinking-dot 1.2s ease-in-out 0.2s infinite" }}
                    />
                    <span
                      className="inline-block w-2 h-2 rounded-full bg-[var(--accent-color)] opacity-80"
                      style={{ animation: "thinking-dot 1.2s ease-in-out 0.4s infinite" }}
                    />
                  </span>
                </div>
              </div>
            )}

            {/* Streaming bubble (draft phase or refine phase) */}
            {isCurrentlyStreaming && streamingContent && (
              <div className="flex flex-col gap-1 items-start">
                <div className="max-w-[75%] rounded-2xl px-4 py-2.5 text-sm message-assistant">
                  {dualModelEnabled && draftModel && !isRefiningPhase && (
                    <div className="flex items-center gap-1 mb-1 text-[10px] text-amber-400">
                      <Zap size={9} /> Drafting with {draftModel}…
                    </div>
                  )}
                  {isRefiningPhase && (
                    <div className="flex items-center gap-1 mb-1 text-[10px] text-[var(--accent-color)]">
                      <Zap size={9} /> Refining with {selectedModel}…
                    </div>
                  )}
                  <div className="prose prose-sm prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent}</ReactMarkdown>
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
                className="flex-1 resize-none px-3.5 py-2.5 text-sm rounded-xl bg-[var(--bg-input)] border-2 border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] focus:shadow-[0_0_0_3px_rgba(var(--accent-color-rgb),0.1)] transition-colors max-h-40 overflow-y-auto"
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
      )}

      {/* ── Thought Queue right panel ─────────────────────────────────────── */}
      {thoughtPanelOpen && (
        <div className="w-72 shrink-0 border-l border-[var(--border-color)] flex flex-col bg-[var(--bg-sidebar)] overflow-hidden">
          {/* header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-color)] shrink-0">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
              <Inbox size={13} /> Thought Queue
            </div>
            <button onClick={() => setThoughtPanelOpen(false)} className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
              <X size={13} />
            </button>
          </div>

          {/* quick-add */}
          <div className="p-3 border-b border-[var(--border-color)] shrink-0 space-y-2">
            <textarea
              value={thoughtDraft}
              onChange={(e) => setThoughtDraft(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submitThought(); }}
              placeholder="Dump a thought… (⌘↵ to add)"
              rows={3}
              className="w-full text-xs px-2.5 py-1.5 rounded-md bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none resize-none focus:border-[var(--accent-color)]"
            />
            <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] cursor-pointer select-none">
              <input type="checkbox" checked={thoughtScheduleEnabled} onChange={(e) => setThoughtScheduleEnabled(e.target.checked)} className="rounded" />
              <Clock size={11} /> Schedule
            </label>
            {thoughtScheduleEnabled && (
              <input
                type="datetime-local"
                value={thoughtSchedule}
                onChange={(e) => setThoughtSchedule(e.target.value)}
                className="w-full text-[11px] px-2 py-1 rounded-md bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
              />
            )}
            <button
              onClick={submitThought}
              disabled={thoughtSubmitting || !thoughtDraft.trim()}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-[var(--accent-color)] text-white text-xs font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {thoughtSubmitting ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              {thoughtScheduleEnabled ? "Schedule" : "Add"}
            </button>
          </div>

          {/* list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {thoughts.length === 0 ? (
              <p className="text-[11px] text-[var(--text-muted)] text-center pt-6">No thoughts yet.</p>
            ) : (
              [...thoughts.filter((t) => t.status === "processing"), ...thoughts.filter((t) => t.status === "scheduled"), ...thoughts.filter((t) => t.status === "pending"), ...thoughts.filter((t) => t.status === "done")].map((t) => (
                <div
                  key={t.id}
                  className={`rounded-lg border text-[11px] ${
                    t.status === "processing" ? "border-yellow-500/30 bg-yellow-500/5" :
                    t.status === "done" ? "border-green-500/20 bg-[var(--bg-primary)]" :
                    "border-[var(--border-color)] bg-[var(--bg-primary)]"
                  }`}
                >
                  <div className="p-2">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      {t.status === "pending" && <span className="text-[var(--text-muted)]">pending</span>}
                      {t.status === "scheduled" && <span className="flex items-center gap-0.5 text-blue-400"><Clock size={9} /> scheduled</span>}
                      {t.status === "processing" && <span className="flex items-center gap-0.5 text-yellow-400"><Loader2 size={9} className="animate-spin" /> running</span>}
                      {t.status === "done" && <span className="flex items-center gap-0.5 text-green-400"><CheckCircle2 size={9} /> done</span>}
                      <span className="ml-auto text-[var(--text-muted)] opacity-60">{new Date(t.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="text-[var(--text-primary)] leading-snug line-clamp-3 whitespace-pre-wrap">{t.content}</p>
                    <div className="flex items-center gap-1 mt-1.5">
                      {(t.status === "pending" || t.status === "scheduled") && (
                        <button onClick={() => processDueThought({ ...t, status: "scheduled" })} title="Process now" className="text-[var(--text-muted)] hover:text-[var(--accent-color)] transition-colors">
                          <Zap size={11} />
                        </button>
                      )}
                      {t.result && (
                        <button onClick={() => setThoughtExpandedId(thoughtExpandedId === t.id ? null : t.id)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                          {thoughtExpandedId === t.id ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        </button>
                      )}
                      <button onClick={async () => { await api.thoughtQueue.delete(t.id).catch(() => {}); setThoughts((prev) => prev.filter((x) => x.id !== t.id)); }} className="ml-auto text-[var(--text-muted)] hover:text-red-400 transition-colors">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                  {thoughtExpandedId === t.id && t.result && (
                    <div className="border-t border-[var(--border-color)] px-2 py-2">
                      <p className="text-[var(--text-primary)] whitespace-pre-wrap leading-snug">{t.result}</p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
