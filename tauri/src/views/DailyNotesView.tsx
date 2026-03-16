/**
 * DailyNotesView — calendar + daily note editor with SmartTextEditor [[links]].
 * Mirrors the original DailyNotesView.swift.
 */
import { useEffect, useState } from "react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, subMonths, addMonths } from "date-fns";
import { ChevronLeft, ChevronRight, Moon, Zap, Save } from "lucide-react";
import { api, type DailyNote } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import SmartTextEditor from "../components/SmartTextEditor";

export default function DailyNotesView() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [note, setNote] = useState<DailyNote | null>(null);
  const [content, setContent] = useState("");
  const [mood, setMood] = useState<number | undefined>(undefined);
  const [productivity, setProductivity] = useState<number | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

  // Pad start of calendar grid
  const startPad = startOfMonth(currentMonth).getDay(); // 0=Sun

  useEffect(() => {
    if (!activeWorkspaceId) return;
    const dateStr = format(selectedDate, "yyyy-MM-dd");
    api.note.getDailyNote(activeWorkspaceId, dateStr)
      .then((n) => {
        setNote(n);
        setContent(n.content ?? "");
        setMood(n.mood ?? undefined);
        setProductivity(n.productivity ?? undefined);
      })
      .catch(() => {});
  }, [activeWorkspaceId, selectedDate]);

  // Auto-save debounce
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => saveNote(), 2000);
    return () => clearTimeout(t);
  }, [content, mood, productivity]);

  async function saveNote() {
    if (!note) return;
    setSaving(true);
    try {
      await api.note.update(note.id, { content, mood, productivity } as any);
      setLastSaved(new Date());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Calendar panel */}
      <div className="w-64 border-r border-[var(--border-color)] flex flex-col bg-[var(--bg-sidebar)]">
        {/* Month nav */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <button onClick={() => setCurrentMonth((m) => subMonths(m, 1))} className="p-1 hover:bg-[var(--bg-hover)] rounded">
            <ChevronLeft size={14} className="text-[var(--text-muted)]" />
          </button>
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            {format(currentMonth, "MMMM yyyy")}
          </span>
          <button onClick={() => setCurrentMonth((m) => addMonths(m, 1))} className="p-1 hover:bg-[var(--bg-hover)] rounded">
            <ChevronRight size={14} className="text-[var(--text-muted)]" />
          </button>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 px-2 pt-2">
          {["Su","Mo","Tu","We","Th","Fr","Sa"].map((d) => (
            <div key={d} className="text-center text-[10px] text-[var(--text-muted)] pb-1">{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 px-2 gap-y-0.5">
          {Array.from({ length: startPad }).map((_, i) => <div key={`pad-${i}`} />)}
          {days.map((day) => {
            const isToday = isSameDay(day, new Date());
            const isSelected = isSameDay(day, selectedDate);
            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDate(day)}
                className={`aspect-square flex items-center justify-center text-xs rounded-full transition-colors ${
                  isSelected
                    ? "bg-[var(--accent-color)] text-white"
                    : isToday
                    ? "text-[var(--accent-color)] font-semibold hover:bg-[var(--bg-hover)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                {format(day, "d")}
              </button>
            );
          })}
        </div>

        {/* Mood / productivity sliders */}
        {note && (
          <div className="px-4 py-3 mt-2 border-t border-[var(--border-color)] space-y-3">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <Moon size={12} className="text-[var(--text-muted)]" />
                <span className="text-[11px] text-[var(--text-muted)]">Mood {mood ?? "—"}</span>
              </div>
              <input
                type="range" min={1} max={10} step={1}
                value={mood ?? 5}
                onChange={(e) => setMood(Number(e.target.value))}
                className="w-full accent-[var(--accent-color)]"
              />
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <Zap size={12} className="text-[var(--text-muted)]" />
                <span className="text-[11px] text-[var(--text-muted)]">Productivity {productivity ?? "—"}</span>
              </div>
              <input
                type="range" min={1} max={10} step={1}
                value={productivity ?? 5}
                onChange={(e) => setProductivity(Number(e.target.value))}
                className="w-full accent-[var(--accent-color)]"
              />
            </div>
          </div>
        )}
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)]">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {format(selectedDate, "EEEE, MMMM d, yyyy")}
          </h2>
          <div className="flex items-center gap-3">
            {lastSaved && (
              <span className="text-[11px] text-[var(--text-muted)]">
                Saved {format(lastSaved, "HH:mm")}
              </span>
            )}
            <button
              onClick={saveNote}
              disabled={saving}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-[var(--accent-color)] text-white disabled:opacity-50 hover:opacity-90"
            >
              <Save size={12} /> Save
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!activeWorkspaceId ? (
            <p className="text-[var(--text-muted)] text-sm">Select a workspace to view daily notes.</p>
          ) : (
            <SmartTextEditor
              value={content}
              onChange={setContent}
              placeholder="How was your day? Use [[concept]] to link ideas…"
              minHeight="calc(100vh - 160px)"
            />
          )}
        </div>
      </div>
    </div>
  );
}
