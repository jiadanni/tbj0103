import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Bug, Download, Info, RefreshCw, Search, Trash2, XCircle } from "lucide-react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { api, type LogEntry } from "../lib/api";
import CompactMenuSelect from "../components/CompactMenuSelect";

const LEVEL_OPTIONS = ["all", "debug", "info", "warn", "error"] as const;

const LEVEL_COLORS: Record<string, string> = {
  debug: "text-gray-400",
  info: "text-blue-400",
  warn: "text-yellow-400",
  error: "text-red-400",
};

const LEVEL_ICONS: Record<string, React.ReactNode> = {
  debug: <Bug size={14} />,
  info: <Info size={14} />,
  warn: <AlertTriangle size={14} />,
  error: <XCircle size={14} />,
};

export default function LogsView() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const [entries, srcs] = await Promise.all([
        api.logs.get({
          level: levelFilter === "all" ? undefined : levelFilter,
          source: sourceFilter === "all" ? undefined : sourceFilter,
          search: searchQuery || undefined,
          limit: 1000,
        }),
        api.logs.getSources(),
      ]);
      setLogs(entries);
      setSources(srcs);
    } catch (e) {
      console.error("Failed to fetch logs", e);
    } finally {
      setLoading(false);
    }
  }, [levelFilter, sourceFilter, searchQuery]);

  useEffect(() => {
    setLoading(true);
    fetchLogs();
  }, [fetchLogs]);

  // Auto-poll every 3 seconds
  useEffect(() => {
    pollRef.current = setInterval(fetchLogs, 3000);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); }
    };
  }, [fetchLogs]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleClear = async () => {
    const ok = await confirm("Clear all log entries? This cannot be undone.", {
      title: "Clear Logs",
      kind: "warning",
    });
    if (!ok) { return; }
    try {
      await api.logs.clear();
      setLogs([]);
    } catch (e) {
      console.error("Failed to clear logs", e);
    }
  };

  const handleExport = () => {
    const lines = logs
      .slice()
      .reverse()
      .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.source}] ${l.message}`)
      .join("\n");
    const blob = new Blob([lines], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aetherium-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); }
      else { next.add(id); }
      return next;
    });
  };

  const formatTimestamp = (ts: string) => {
    try {
      const d = new Date(ts + "Z");
      return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return ts;
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Header / Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-color)] shrink-0 flex-wrap">
        <h1 className="text-lg font-semibold mr-2">Logs</h1>

        {/* Level filter chips */}
        <div className="flex items-center gap-1">
          {LEVEL_OPTIONS.map((level) => (
            <button
              key={level}
              onClick={() => setLevelFilter(level)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                levelFilter === level
                  ? "bg-[var(--accent-color)] text-white border-[var(--accent-color)]"
                  : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              {level === "all" ? "All" : level.charAt(0).toUpperCase() + level.slice(1)}
            </button>
          ))}
        </div>

        {/* Source filter */}
        <CompactMenuSelect
          label="Source"
          value={sourceFilter}
          options={[
            { value: "all", label: "All sources" },
            ...sources.map((s) => ({ value: s, label: s })),
          ]}
          onChange={(val) => setSourceFilter(val)}
          widthClassName="min-w-[140px]"
        />

        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-[320px]">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Search logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-7 pr-2 py-1 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
        </div>

        <div className="flex items-center gap-1 ml-auto">
          {/* Auto-scroll toggle */}
          <label className="flex items-center gap-1 text-xs text-[var(--text-secondary)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded"
            />
            Tail
          </label>

          <button
            onClick={fetchLogs}
            className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>

          <button
            onClick={handleExport}
            className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
            title="Export logs"
          >
            <Download size={14} />
          </button>

          <button
            onClick={handleClear}
            className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-red-400"
            title="Clear all logs"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Log entries */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto font-mono text-xs">
        {logs.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
            No log entries
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-left">
              <tr>
                <th className="px-3 py-1.5 w-[140px]">Time</th>
                <th className="px-3 py-1.5 w-[70px]">Level</th>
                <th className="px-3 py-1.5 w-[100px]">Source</th>
                <th className="px-3 py-1.5">Message</th>
              </tr>
            </thead>
            <tbody>
              {logs
                .slice()
                .reverse()
                .map((log) => (
                  <tr
                    key={log.id}
                    onClick={() => toggleExpand(log.id)}
                    className="border-b border-[var(--border-color)]/30 hover:bg-[var(--bg-hover)] cursor-pointer"
                  >
                    <td className="px-3 py-1 text-[var(--text-muted)] whitespace-nowrap align-top">
                      {formatTimestamp(log.timestamp)}
                    </td>
                    <td className={`px-3 py-1 whitespace-nowrap align-top ${LEVEL_COLORS[log.level] ?? ""}`}>
                      <span className="flex items-center gap-1">
                        {LEVEL_ICONS[log.level]}
                        {log.level}
                      </span>
                    </td>
                    <td className="px-3 py-1 text-[var(--text-secondary)] whitespace-nowrap align-top">
                      {log.source}
                    </td>
                    <td className="px-3 py-1 align-top">
                      <div className={expandedIds.has(log.id) ? "" : "line-clamp-2"}>
                        {log.message}
                      </div>
                      {expandedIds.has(log.id) && log.metadata && log.metadata !== "{}" && (
                        <pre className="mt-1 p-1.5 rounded bg-[var(--bg-secondary)] text-[var(--text-muted)] text-[10px] overflow-x-auto">
                          {JSON.stringify(JSON.parse(log.metadata), null, 2)}
                        </pre>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
