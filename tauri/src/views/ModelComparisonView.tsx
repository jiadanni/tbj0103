/**
 * ModelComparisonView — mirrors ModelComparisonView.swift.
 * Run the same prompt against two Ollama models side-by-side.
 */
import React, { useEffect, useRef, useState } from "react";
import { Send, RefreshCw } from "lucide-react";
import { api, type OllamaModel } from "../lib/api";
import { useSettingsStore } from "../stores/settingsStore";

export default function ModelComparisonView() {
  const { ollamaUrl, preferredModel, modelLabels } = useSettingsStore();
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [modelA, setModelA] = useState("");
  const [modelB, setModelB] = useState("");
  const [prompt, setPrompt] = useState("");
  const [responseA, setResponseA] = useState("");
  const [responseB, setResponseB] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.ollama.listModels(ollamaUrl || undefined).then((list) => {
      setModels(list);
      if (list.length > 0) {setModelA(list[0].name);}
      if (list.length > 1) {setModelB(list[1].name);}
      else if (list.length === 1) {setModelB(list[0].name);}
    }).catch(() => {
      // Fall back to preferred model if Ollama unavailable
      if (preferredModel) {
        setModelA(preferredModel);
        setModelB(preferredModel);
      }
    });
  }, [ollamaUrl, preferredModel]);

  async function run() {
    if (!prompt.trim() || loading) {return;}
    const p = prompt.trim();
    setPrompt("");
    setResponseA("");
    setResponseB("");
    setError(null);
    setLoading(true);

    try {
      const messages = [{ role: "user", content: p }];
      const [resA, resB] = await Promise.all([
        api.ollama.sendMessage("compare-a", modelA, messages, false, ollamaUrl || undefined),
        api.ollama.sendMessage("compare-b", modelB, messages, false, ollamaUrl || undefined),
      ]);
      setResponseA(resA);
      setResponseB(resB);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
  }

  function refreshModels() {
    api.ollama.listModels(ollamaUrl || undefined).then(setModels).catch(() => {});
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header + model selectors */}
      <div className="flex items-stretch border-b border-[var(--border-color)] flex-shrink-0 bg-[var(--bg-elevated)]">
        {/* Model A picker */}
        <div className="flex-1 px-4 py-3 flex flex-col gap-1 border-r border-[var(--border-color)]">
          <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Model A</label>
          <ModelPicker value={modelA} models={models} onChange={setModelA} modelLabels={modelLabels} />
        </div>

        {/* Refresh */}
        <div className="flex items-center px-3">
          <button
            onClick={refreshModels}
            title="Refresh model list"
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {/* Model B picker */}
        <div className="flex-1 px-4 py-3 flex flex-col gap-1 border-l border-[var(--border-color)]">
          <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Model B</label>
          <ModelPicker value={modelB} models={models} onChange={setModelB} modelLabels={modelLabels} />
        </div>
      </div>

      {/* Responses */}
      <div className="flex flex-1 overflow-hidden divide-x divide-[var(--border-color)]">
        <ResponsePanel
          label="Model A"
          modelName={modelA}
          modelLabels={modelLabels}
          text={responseA}
          loading={loading}
        />
        <ResponsePanel
          label="Model B"
          modelName={modelB}
          modelLabels={modelLabels}
          text={responseB}
          loading={loading}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 text-xs text-red-400 bg-red-500/10 border-t border-red-500/20 flex-shrink-0">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-[var(--border-color)] px-4 py-3 flex gap-3 items-end flex-shrink-0">
        <textarea
          ref={textareaRef}
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter prompt to compare… (⌘↵ to send)"
          className="flex-1 resize-none px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)] min-h-[40px] max-h-[120px]"
        />
        <button
          onClick={run}
          disabled={!prompt.trim() || loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-white bg-[var(--accent-color)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          <Send size={14} />
          {loading ? "Running…" : "Compare"}
        </button>
      </div>
    </div>
  );
}

function ModelPicker({
  value,
  models,
  onChange,
  modelLabels,
}: {
  value: string;
  models: OllamaModel[];
  onChange: (v: string) => void;
  modelLabels: Record<string, string>;
}) {
  if (models.length === 0) {
    return (
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. llama3"

        className="text-sm bg-transparent border-b border-[var(--border-color)] text-[var(--text-primary)] outline-none py-0.5 w-full placeholder:text-[var(--text-muted)]"
      />
    );
  }
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-sm bg-transparent text-[var(--text-primary)] outline-none py-0.5 w-full cursor-pointer"
    >
      {models.map((m) => (
        <option key={m.name} value={m.name}>
          {modelLabels[m.name] || m.name}
        </option>
      ))}
    </select>
  );
}

function ResponsePanel({
  label,
  modelName,
  modelLabels,
  text,
  loading,
}: {
  label: string;
  modelName: string;
  modelLabels: Record<string, string>;
  text: string;
  loading: boolean;
}) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-elevated)] flex-shrink-0">
        <span className="text-xs font-medium text-[var(--text-primary)]">{label}</span>
        {modelName && (
          <span className="ml-2 text-xs text-[var(--text-muted)]">{modelLabels[modelName] || modelName}</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading && !text ? (
          <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm">
            <span className="animate-pulse">●</span> Generating…
          </div>
        ) : text ? (
          <pre className="text-sm text-[var(--text-primary)] whitespace-pre-wrap font-[inherit] leading-relaxed">
            {text}
          </pre>
        ) : (
          <p className="text-sm text-[var(--text-muted)] italic">Response will appear here…</p>
        )}
      </div>
    </div>
  );
}
