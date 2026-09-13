import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AlertTriangle, ArrowDownToLine, Bug, Calendar, Check, Download, Info, RefreshCw, Search, Trash2, X, XCircle } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { api, type LogEntry } from "../lib/api";
import { rawConsole } from "../lib/consoleTimestamps";
import { CompactMenuSelect } from "../components/CompactMenuSelect";
import ConfirmDialog from "../components/ConfirmDialog";
import { Tooltip } from "../components/Tooltip";

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

const LOG_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function formatTimestamp(ts: string): string {
  try {
    const isoTs = ts.includes("T") ? ts : ts.replace(" ", "T") + "Z";
    const d = new Date(isoTs);
    if (isNaN(d.getTime())) {
      return ts;
    }
    return LOG_DATE_FORMATTER.format(d);
  } catch {
    return ts;
  }
}

interface LogRowProps {
  log: LogEntry;
  isExpanded: boolean;
  onToggleExpand: (id: number) => void;
}

const LogRow = React.memo(function LogRow({ log, isExpanded, onToggleExpand }: LogRowProps) {
  return (
    <tr
      onClick={() => onToggleExpand(log.id)}
      className="border-b border-[var(--border-color)]/30 hover:bg-[var(--bg-hover)] cursor-pointer"
      style={{ contentVisibility: "auto", containIntrinsicSize: "0 28px" }}
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
        <div className={isExpanded ? "" : "line-clamp-2"}>
          {log.message}
        </div>
        {isExpanded && log.metadata && log.metadata !== "{}" && (
          <pre className="mt-1 p-1.5 rounded bg-[var(--bg-secondary)] text-[var(--text-muted)] text-[10px] overflow-x-auto">
            {(() => {
              try {
                return JSON.stringify(JSON.parse(log.metadata), null, 2);
              } catch {
                return log.metadata;
              }
            })()}
          </pre>
        )}
      </td>
    </tr>
  );
});

export default function LogsView() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [filterExports, setFilterExports] = useState(true);
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const reversedLogs = useMemo(() => logs.slice().reverse(), [logs]);
  const isFetchingRef = useRef(false);
  // Set when a "logs-appended" event (or another fetchLogs call) arrives
  // while a fetch is already in flight, so we refetch once more right after
  // instead of silently dropping rows written during the in-flight fetch.
  const refetchPendingRef = useRef(false);
  const appendedDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const filtersRef = useRef({
    levelFilter,
    sourceFilter,
    debouncedSearchQuery,
    startDate,
    endDate,
  });
  filtersRef.current = {
    levelFilter,
    sourceFilter,
    debouncedSearchQuery,
    startDate,
    endDate,
  };

  const fetchLogs = useCallback(async () => {
    if (isFetchingRef.current) {
      refetchPendingRef.current = true;
      return;
    }
    isFetchingRef.current = true;
    try {
      do {
        refetchPendingRef.current = false;
        try {
          const current = filtersRef.current;
          const [entries, srcs] = await Promise.all([
            api.logs.get({
              level: current.levelFilter === "all" ? undefined : current.levelFilter,
              source: current.sourceFilter === "all" ? undefined : current.sourceFilter,
              search: current.debouncedSearchQuery || undefined,
              after: current.startDate || undefined,
              before: current.endDate ? `${current.endDate}T23:59:59` : undefined,
              limit: 1000,
            }),
            api.logs.getSources(),
          ]);
          setLogs(entries);
          setSources(srcs);
        } catch (e) {
          // Use rawConsole, not console.error: this view's own error path must
          // not be forwarded to the backend log store, or a broken backend
          // would log an error -> emit "logs-appended" -> refetch -> fail
          // again, forever, at whatever cadence errors are batched.
          rawConsole.error("Failed to fetch logs", e);
          break;
        }
      } while (refetchPendingRef.current);
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchLogs();
  }, [fetchLogs, levelFilter, sourceFilter, debouncedSearchQuery, startDate, endDate]);

  // Event-driven refresh: the backend emits "logs-appended" whenever a new
  // row is written to app_logs, so we refetch on-demand instead of blindly
  // polling every few seconds regardless of whether anything changed. Bursts
  // of events (e.g. a chatty background job) are coalesced with a short
  // debounce instead of triggering one full refetch per row.
  useEffect(() => {
    const unlisten = listen("logs-appended", () => {
      if (appendedDebounceRef.current) { return; }
      appendedDebounceRef.current = setTimeout(() => {
        appendedDebounceRef.current = null;
        void fetchLogs();
      }, 400);
    });
    return () => {
      unlisten.then((fn) => fn());
      if (appendedDebounceRef.current) {
        clearTimeout(appendedDebounceRef.current);
        appendedDebounceRef.current = null;
      }
    };
  }, [fetchLogs]);

  // Auto-scroll to bottom only when autoScroll is active and user hasn't scrolled up
  useEffect(() => {
    if (autoScroll && !userScrolledUpRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [reversedLogs, autoScroll]);

  const handleClear = () => {
    setShowClearConfirm(true);
  };

  const performClear = async () => {
    setClearing(true);
    try {
      await api.logs.clear();
      setLogs([]);
      setShowClearConfirm(false);
    } catch (e) {
      console.error("Failed to clear logs", e);
    } finally {
      setClearing(false);
    }
  };

  const handleExport = async () => {
    if (exporting) { return; }
    setExporting(true);
    try {
      let logsToExport = logs;
      if (filterExports) {
        if (logs.length >= 1000) {
          logsToExport = await api.logs.get({
            level: levelFilter === "all" ? undefined : levelFilter,
            source: sourceFilter === "all" ? undefined : sourceFilter,
            search: debouncedSearchQuery || undefined,
            after: startDate || undefined,
            before: endDate ? `${endDate}T23:59:59` : undefined,
            limit: 5000,
          });
        }
      } else {
        logsToExport = await api.logs.get({ limit: 5000 });
      }

      if (logsToExport.length === 0) { return; }

      const lines = logsToExport
        .slice()
        .reverse()
        .map((l) => {
          const base = `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.source}] ${l.message}`;
          return l.metadata && l.metadata !== "{}" ? `${base} ${l.metadata}` : base;
        })
        .join("\n");
      const defaultFilename = `aetherium-logs-${new Date().toISOString().slice(0, 10)}.txt`;

      const destination = await save({
        title: filterExports ? "Export Filtered Logs" : "Export All Logs",
        defaultPath: defaultFilename,
        filters: [
          { name: "Text Files", extensions: ["txt", "log"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (!destination) { return; }

      await writeTextFile(destination, lines);
      setExported(true);
      setTimeout(() => setExported(false), 2000);
    } catch (e) {
      rawConsole.error("Failed to export logs", e);
    } finally {
      setExporting(false);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0) {
      userScrolledUpRef.current = true;
      if (autoScroll) {
        setAutoScroll(false);
      }
    }
  };

  const handleScroll = () => {
    if (!scrollRef.current) { return; }
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 64;

    if (isAtBottom) {
      userScrolledUpRef.current = false;
      if (!autoScroll) {
        setAutoScroll(true);
      }
    } else if (autoScroll) {
      setAutoScroll(false);
    }
  };

  const toggleExpand = useCallback((id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); }
      else { next.add(id); }
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-color)] shrink-0 flex-wrap">

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

        {/* Date range filter */}
        <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <Calendar size={13} className="text-[var(--text-muted)] shrink-0" />
          <input
            type="date"
            value={startDate}
            max={endDate || undefined}
            onChange={(e) => setStartDate(e.target.value)}
            title="Start date"
            aria-label="Start date"
            className="px-2 py-1 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-color)]"
          />
          <span className="text-[var(--text-muted)]">–</span>
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => setEndDate(e.target.value)}
            title="End date"
            aria-label="End date"
            className="px-2 py-1 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-color)]"
          />
          {(startDate || endDate) && (
            <button
              onClick={() => { setStartDate(""); setEndDate(""); }}
              title="Clear date range"
              aria-label="Clear date range"
              className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[160px] max-w-[280px]">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Search logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-7 pr-2 py-1 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={filterExports}
              onChange={(e) => setFilterExports(e.target.checked)}
              aria-label="Filter exports"
              className="rounded border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--accent-color)] focus:ring-0 focus:ring-offset-0 cursor-pointer"
            />
            <span>Filter exports</span>
          </label>

          <div className="h-4 w-[1px] bg-[var(--border-color)]" />

          <Tooltip content="Refresh" position="top">
            <button
              onClick={fetchLogs}
              className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </Tooltip>

          <Tooltip content={exported ? "Logs exported" : filterExports ? "Export filtered logs" : "Export all logs"} position="top">
            <button
              onClick={handleExport}
              disabled={exporting || (filterExports && logs.length === 0)}
              aria-label={exported ? "Logs exported" : filterExports ? "Export filtered logs" : "Export all logs"}
              className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {exported ? (
                <Check size={14} className="text-emerald-400" />
              ) : exporting ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
            </button>
          </Tooltip>

          <Tooltip content="Clear all logs" position="top">
            <button
              onClick={handleClear}
              className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-red-400"
            >
              <Trash2 size={14} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Log entries */}
      <div className="flex-1 min-h-0 flex flex-col">
      <div 
        ref={scrollRef} 
        onScroll={handleScroll}
        onWheel={handleWheel}
        className="flex-1 min-h-0 overflow-y-auto font-mono text-xs"
      >
        {logs.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
            No log entries
          </div>
        ) : (
          <table className="w-full">
            <thead className="z-20 text-[var(--text-secondary)] text-left border-b border-[var(--border-color)]">
              <tr>
                <th className="sticky top-0 px-3 py-1.5 w-[140px] font-semibold bg-[var(--bg-primary)] z-20">Time</th>
                <th className="sticky top-0 px-3 py-1.5 w-[70px] font-semibold bg-[var(--bg-primary)] z-20">Level</th>
                <th className="sticky top-0 px-3 py-1.5 w-[100px] font-semibold bg-[var(--bg-primary)] z-20">Source</th>
                <th className="sticky top-0 px-3 py-1.5 font-semibold bg-[var(--bg-primary)] z-20">Message</th>
              </tr>
            </thead>
            <tbody>
              {reversedLogs.map((log) => (
                <LogRow
                  key={log.id}
                  log={log}
                  isExpanded={expandedIds.has(log.id)}
                  onToggleExpand={toggleExpand}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
      {!autoScroll && (
        <div className="flex justify-center py-2 border-t border-[var(--border-color)] bg-[var(--bg-primary)] shrink-0">
          <Tooltip content="Jump to Bottom & Tail" position="top">
            <button
              onClick={() => {
                userScrolledUpRef.current = false;
                setAutoScroll(true);
                if (scrollRef.current) {
                  scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent-color)] text-white text-xs shadow hover:opacity-90 transition-opacity"
            >
              <ArrowDownToLine size={13} />
              <span>Scroll to bottom</span>
            </button>
          </Tooltip>
        </div>
      )}
      </div>
      {showClearConfirm && (
        <ConfirmDialog
          title="Clear Logs"
          description="Are you sure you want to clear all log entries? This action cannot be undone."
          confirmLabel="Clear All Logs"
          tone="danger"
          busy={clearing}
          onConfirm={performClear}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
    </div>
  );
}
