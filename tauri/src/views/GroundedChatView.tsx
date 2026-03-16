/**
 * GroundedChatView — RAG-powered chat that injects relevant document chunks
 * as context before sending messages to Ollama.
 */
import { useState, useRef, useEffect } from "react";
import {
  BookOpen,
  Send,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  FileText,
} from "lucide-react";
import { api, SearchResult } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";

interface GroundedMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SearchResult[];
  isStreaming?: boolean;
}

export default function GroundedChatView() {
  const { activeProjectId } = useWorkspaceStore();
  const { preferredModel, ollamaUrl } = useSettingsStore();

  const [messages, setMessages] = useState<GroundedMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [topK, setTopK] = useState(5);
  const [showSources, setShowSources] = useState<string | null>(null);
  const [documents, setDocuments] = useState<{ id: string; filename: string }[]>([]);
  const [docCount, setDocCount] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load processed document count for this project
  useEffect(() => {
    if (!activeProjectId) return;
    api.document.list(activeProjectId).then((docs) => {
      const processed = docs.filter((d) => d.is_processed);
      setDocuments(processed);
      setDocCount(processed.length);
    });
  }, [activeProjectId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading || !activeProjectId) return;
    const userText = input.trim();
    setInput("");
    setLoading(true);

    const userMsg: GroundedMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: userText,
    };

    const assistantMsgId = crypto.randomUUID();
    const assistantMsg: GroundedMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    try {
      // 1. Keyword search for grounding context (embeddings optional)
      const keywordResults = await api.search.keyword(
        userText,
        "",   // workspace_id not needed here since we pass project_id separately
        activeProjectId
      );

      // Filter to document_chunk results only
      const chunkResults = keywordResults.filter(
        (r) => r.result_type === "document_chunk"
      );

      // 2. Build grounded context prompt
      let groundedPrompt = userText;
      if (chunkResults.length > 0) {
        const contextParts = chunkResults.slice(0, topK).map((r, i) => {
          return `[${i + 1}] **${r.title}**: ${r.excerpt}`;
        });
        groundedPrompt =
          `You have access to the following document excerpts:\n\n` +
          contextParts.join("\n\n") +
          `\n\nUsing the above context where relevant, answer: ${userText}\n\n` +
          `Cite sources as [1], [2], etc. when referencing specific content.`;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, sources: chunkResults.slice(0, topK) } : m
          )
        );
      }

      // 3. Build message history (last 8 turns) + grounded user message
      const history = messages.slice(-8).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      history.push({ role: "user", content: groundedPrompt });

      // 4. Send to Ollama (streaming)
      const sessionId = `grounded_${Date.now()}`;
      let unlistenFn: (() => void) | null = null;

      unlistenFn = await api.listenStream(sessionId, (chunk) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: m.content + chunk }
              : m
          )
        );
      });

      await api.ollama.sendMessage(sessionId, preferredModel, history, true, ollamaUrl);

      if (unlistenFn) unlistenFn();

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId ? { ...m, isStreaming: false } : m
        )
      );
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: `Error: ${err}`, isStreaming: false }
            : m
        )
      );
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = () => {
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <BookOpen size={18} className="text-[var(--accent)]" />
          <h2 className="font-semibold">Grounded Chat</h2>
          {docCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-[var(--accent)] text-white">
              {docCount} doc{docCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5">
            Top-K
            <select
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
              className="text-xs rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5"
            >
              {[3, 5, 8, 10].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={clearChat}
            className="p-1.5 rounded hover:bg-[var(--surface-2)] text-[var(--text-secondary)] transition-colors"
            title="Clear chat"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* No documents warning */}
      {docCount === 0 && activeProjectId && (
        <div className="mx-4 mt-3 px-3 py-2 rounded bg-yellow-500/10 border border-yellow-500/30 text-sm text-yellow-600 dark:text-yellow-400 flex items-start gap-2">
          <FileText size={15} className="mt-0.5 flex-shrink-0" />
          <span>
            No processed documents found. Upload and process documents in the{" "}
            <span className="font-medium">Document Browser</span> to enable
            grounded responses.
          </span>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-[var(--text-secondary)]">
            <BookOpen size={40} className="mb-4 opacity-20" />
            <p className="font-medium">Ask anything about your documents</p>
            <p className="text-sm mt-1 opacity-70">
              Relevant passages will be automatically retrieved and cited.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                msg.role === "user"
                  ? "bg-[var(--accent)] text-white rounded-br-sm"
                  : "bg-[var(--surface-2)] rounded-bl-sm"
              }`}
            >
              <p className="text-sm whitespace-pre-wrap leading-relaxed">
                {msg.content}
                {msg.isStreaming && (
                  <span className="inline-block w-1.5 h-4 bg-current ml-0.5 animate-pulse rounded-sm" />
                )}
              </p>

              {/* Sources toggle */}
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-2 pt-2 border-t border-white/20">
                  <button
                    onClick={() =>
                      setShowSources(showSources === msg.id ? null : msg.id)
                    }
                    className="flex items-center gap-1 text-xs opacity-80 hover:opacity-100 transition-opacity"
                  >
                    <FileText size={12} />
                    {msg.sources.length} source{msg.sources.length !== 1 ? "s" : ""}
                    {showSources === msg.id ? (
                      <ChevronUp size={12} />
                    ) : (
                      <ChevronDown size={12} />
                    )}
                  </button>

                  {showSources === msg.id && (
                    <div className="mt-2 space-y-1.5">
                      {msg.sources.map((s, i) => (
                        <div
                          key={s.id}
                          className="rounded p-2 bg-black/10 text-xs"
                        >
                          <div className="font-medium mb-0.5">
                            [{i + 1}] {s.title}
                          </div>
                          <div className="opacity-70 line-clamp-2">
                            {s.excerpt}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-[var(--border)]">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              activeProjectId
                ? "Ask a question about your documents…"
                : "Select a project first"
            }
            disabled={loading || !activeProjectId}
            rows={2}
            className="flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5 text-sm focus:outline-none focus:border-[var(--accent)] disabled:opacity-50 transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading || !activeProjectId}
            className="flex-shrink-0 p-3 rounded-xl bg-[var(--accent)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {loading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={18} />
            )}
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--text-secondary)]">
          Enter to send · Shift+Enter for newline · Model: {preferredModel}
        </p>
      </div>
    </div>
  );
}
