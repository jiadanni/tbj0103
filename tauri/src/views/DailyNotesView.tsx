/**
 * DailyNotesView — calendar + daily note editor with SmartTextEditor [[links]].
 * Mirrors the original DailyNotesView.swift: calendar dot indicators, day nav,
 * mood emoji selector, productivity stars, template picker, stats panel, empty state.
 */
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  subMonths,
  addMonths,
  addDays,
  subDays,
} from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Save,
  FileText,
  Flame,
  Star,
  CalendarPlus,
} from "lucide-react";
import { api, type DailyNote, type NoteTemplate } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import SmartTextEditor from "../components/SmartTextEditor";

// Mood options matching Swift's DailyNoteMetadataView
const MOOD_OPTIONS = [
  { emoji: "😔", label: "Down", value: 2 },
  { emoji: "😐", label: "Neutral", value: 4 },
  { emoji: "🙂", label: "Good", value: 6 },
  { emoji: "😊", label: "Great", value: 8 },
  { emoji: "🤩", label: "Amazing", value: 10 },
] as const;

function moodToEmoji(mood: number | undefined): string {
  if (mood === undefined) {return "";}
  const match = MOOD_OPTIONS.reduce((prev, curr) =>
    Math.abs(curr.value - mood) < Math.abs(prev.value - mood) ? curr : prev
  );
  return match.emoji;
}

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

  // Calendar dot indicators — dates that have notes this month
  const [monthNotes, setMonthNotes] = useState<DailyNote[]>([]);
  const datesWithNotes = useMemo(
    () => new Set(monthNotes.map((n) => n.date)),
    [monthNotes]
  );

  // Template picker
  const [templates, setTemplates] = useState<NoteTemplate[]>([]);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });
  const startPad = startOfMonth(currentMonth).getDay();

  // --- Stats ---
  const stats = useMemo(() => {
    const totalNotes = monthNotes.length;
    const prods = monthNotes.map((n) => n.productivity).filter((p): p is number => p != null);
    const avgProductivity = prods.length ? (prods.reduce((a, b) => a + b, 0) / prods.length) : 0;

    // Streak: consecutive days ending today (or most recent)
    let streak = 0;
    let d = new Date();
    while (true) {
      const ds = format(d, "yyyy-MM-dd");
      if (datesWithNotes.has(ds)) {
        streak++;
        d = subDays(d, 1);
      } else {
        break;
      }
    }
    return { totalNotes, avgProductivity, streak };
  }, [monthNotes, datesWithNotes]);

  // --- Load month notes for dot indicators ---
  useEffect(() => {
    if (!activeWorkspaceId) {return;}
    const start = format(startOfMonth(currentMonth), "yyyy-MM-dd");
    const end = format(endOfMonth(currentMonth), "yyyy-MM-dd");
    api.note.listDailyNotesInRange(activeWorkspaceId, start, end)
      .then(setMonthNotes)
      .catch(() => {});
  }, [activeWorkspaceId, currentMonth]);

  // --- Load selected date note ---
  useEffect(() => {
    if (!activeWorkspaceId) {return;}
    const dateStr = format(selectedDate, "yyyy-MM-dd");
    api.note.getDailyNote(activeWorkspaceId, dateStr)
      .then((n) => {
        setNote(n);
        setContent(n.content ?? "");
        setMood(n.mood ?? undefined);
        setProductivity(n.productivity ?? undefined);
      })
      .catch(() => setNote(null));
  }, [activeWorkspaceId, selectedDate]);

  // --- Load templates ---
  useEffect(() => {
    if (!activeWorkspaceId) {return;}
    api.note.listTemplates(activeWorkspaceId).then(setTemplates).catch(() => {});
  }, [activeWorkspaceId]);

  // --- ESC to close template picker ---
  useEffect(() => {
    if (!showTemplatePicker) { return; }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); setShowTemplatePicker(false); }
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [showTemplatePicker]);

  const saveNote = useCallback(async () => {
    if (!note) {return;}
    setSaving(true);
    try {
      await api.note.updateDailyNote(note.id, content, mood, productivity);
      setLastSaved(new Date());
      // Refresh month notes so dot indicators update
      if (activeWorkspaceId) {
        const start = format(startOfMonth(currentMonth), "yyyy-MM-dd");
        const end = format(endOfMonth(currentMonth), "yyyy-MM-dd");
        api.note.listDailyNotesInRange(activeWorkspaceId, start, end)
          .then(setMonthNotes)
          .catch(() => {});
      }
    } finally {
      setSaving(false);
    }
  }, [note, content, mood, productivity, activeWorkspaceId, currentMonth]);

  // --- Auto-save debounce ---
  useEffect(() => {
    if (!note) {return;}
    const t = setTimeout(() => saveNote(), 2000);
    return () => clearTimeout(t);
  }, [content, mood, productivity, note, saveNote]);


  async function applyTemplate(template: NoteTemplate) {
    try {
      const rendered = await api.note.applyTemplate(template.id);
      setContent(rendered);
    } catch { /* ignore */ }
    setShowTemplatePicker(false);
  }

  // --- Day navigation (Swift DailyNoteHeader) ---
  function moveToPreviousDay() {
    setSelectedDate((d) => subDays(d, 1));
  }
  function moveToNextDay() {
    setSelectedDate((d) => addDays(d, 1));
  }

  // Whether the currently loaded note has any content
  const hasContent = note && (note.content?.trim().length ?? 0) > 0;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* ──── Calendar sidebar ──── */}
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

        {/* Calendar grid with dot indicators */}
        <div className="grid grid-cols-7 px-2 gap-y-0.5">
          {Array.from({ length: startPad }).map((_, i) => <div key={`pad-${i}`} />)}
          {days.map((day) => {
            const isToday = isSameDay(day, new Date());
            const isSelected = isSameDay(day, selectedDate);
            const dateStr = format(day, "yyyy-MM-dd");
            const hasNote = datesWithNotes.has(dateStr);
            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDate(day)}
                className={`flex flex-col items-center justify-center text-xs rounded-lg transition-colors py-1 ${
                  isSelected
                    ? "bg-[var(--accent-color)] text-white"
                    : isToday
                    ? "text-[var(--accent-color)] font-semibold bg-[var(--accent-color)]/10 hover:bg-[var(--bg-hover)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                <span>{format(day, "d")}</span>
                {hasNote && (
                  <span
                    className={`block w-1 h-1 rounded-full mt-0.5 ${
                      isSelected ? "bg-white" : "bg-[var(--accent-color)]"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* ── Mood emoji selector ── */}
        {note && (
          <div className="px-4 py-3 mt-2 border-t border-[var(--border-color)] space-y-3">
            <div>
              <span className="text-[11px] text-[var(--text-muted)] block mb-1.5">Mood</span>
              <div className="flex justify-between">
                {MOOD_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setMood(opt.value)}
                    title={opt.label}
                    className={`text-lg rounded-md p-1 transition-all ${
                      mood === opt.value
                        ? "bg-[var(--accent-color)]/20 scale-110"
                        : "opacity-50 hover:opacity-80"
                    }`}
                  >
                    {opt.emoji}
                  </button>
                ))}
              </div>
            </div>

            {/* Productivity star selector (1-5 like Swift header) */}
            <div>
              <span className="text-[11px] text-[var(--text-muted)] block mb-1.5">Productivity</span>
              <div className="flex gap-1">
                {[1,2,3,4,5].map((level) => {
                  const filled = productivity !== undefined && (productivity / 2) >= level;
                  return (
                    <button
                      key={level}
                      onClick={() => setProductivity(level * 2)}
                      className="transition-colors"
                    >
                      <Star
                        size={16}
                        className={filled ? "text-amber-400 fill-amber-400" : "text-[var(--text-muted)]"}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Stats panel ── */}
        <div className="px-4 py-3 mt-auto border-t border-[var(--border-color)]">
          <span className="text-[11px] text-[var(--text-muted)] block mb-2">This Month</span>
          <div className="flex gap-4">
            <div className="flex items-center gap-1.5">
              <FileText size={12} className="text-[var(--text-muted)]" />
              <span className="text-xs text-[var(--text-secondary)]">{stats.totalNotes} notes</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Flame size={12} className="text-orange-400" />
              <span className="text-xs text-[var(--text-secondary)]">{stats.streak} streak</span>
            </div>
          </div>
          {stats.avgProductivity > 0 && (
            <span className="text-[10px] text-[var(--text-muted)] mt-1 block">
              Avg productivity: {stats.avgProductivity.toFixed(1)}/10
            </span>
          )}
        </div>
      </div>

      {/* ──── Editor panel ──── */}
      <div className="flex-1 flex min-h-0 flex-col overflow-hidden">
        {/* Header with day navigation (mirrors DailyNoteHeader in Swift) */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/30">
          <div className="flex items-center gap-2">
            <button onClick={moveToPreviousDay} className="p-1 hover:bg-[var(--bg-hover)] rounded">
              <ChevronLeft size={14} className="text-[var(--text-muted)]" />
            </button>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {format(selectedDate, "EEEE, MMMM d, yyyy")}
            </h2>
            <button onClick={moveToNextDay} className="p-1 hover:bg-[var(--bg-hover)] rounded">
              <ChevronRight size={14} className="text-[var(--text-muted)]" />
            </button>
          </div>

          <div className="flex items-center gap-3">
            {/* Mood & productivity display */}
            {mood !== undefined && (
              <span className="text-sm">{moodToEmoji(mood)}</span>
            )}
            {productivity !== undefined && (
              <div className="flex gap-0.5">
                {[1,2,3,4,5].map((l) => (
                  <Star key={l} size={12}
                    className={
                      (productivity / 2) >= l
                        ? "text-amber-400 fill-amber-400"
                        : "text-[var(--text-muted)]"
                    }
                  />
                ))}
              </div>
            )}

            {/* Template picker button */}
            <div className="relative">
              <button
                onClick={() => setShowTemplatePicker((v) => !v)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-[var(--border-color)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
              >
                <FileText size={12} /> Template
              </button>
              {showTemplatePicker && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg shadow-lg z-50 py-1 max-h-64 overflow-y-auto">
                  {templates.length === 0 && (
                    <div className="px-3 py-2 text-xs text-[var(--text-muted)]">No templates</div>
                  )}
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => applyTemplate(t)}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

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

        {/* Editor area or empty state */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {!activeWorkspaceId ? (
            <p className="text-[var(--text-muted)] text-sm">Select a workspace to view daily notes.</p>
          ) : !note ? (
            /* Empty state — mirrors CreateDailyNoteView in Swift */
            <div className="flex flex-col items-center justify-center h-full gap-5 text-center">
              <CalendarPlus size={56} className="text-[var(--accent-color)] opacity-70" />
              <div>
                <p className="text-base font-medium text-[var(--text-primary)]">No daily note for this day</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Select a date or click below to create one.
                </p>
              </div>
              <button
                onClick={() => {
                  if (!activeWorkspaceId) {return;}
                  const dateStr = format(selectedDate, "yyyy-MM-dd");
                  api.note.getDailyNote(activeWorkspaceId, dateStr).then((n) => {
                    setNote(n);
                    setContent(n.content ?? "");
                    setMood(n.mood ?? undefined);
                    setProductivity(n.productivity ?? undefined);
                  });
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent-color)] text-white text-sm hover:opacity-90"
              >
                <CalendarPlus size={16} /> Create Daily Note
              </button>
            </div>
          ) : !hasContent && content.trim().length === 0 ? (
            /* Note exists but is empty — show editor with prominent placeholder */
            <div className="h-full min-h-0">
              <SmartTextEditor
                value={content}
                onChange={setContent}
                placeholder="How was your day? Use [[concept]] to link ideas…"
                minHeight="100%"
              />
            </div>
          ) : (
            <div className="h-full min-h-0">
              <SmartTextEditor
                value={content}
                onChange={setContent}
                placeholder="How was your day? Use [[concept]] to link ideas…"
                minHeight="100%"
              />
            </div>
          )}
        </div>
      </div>

      {/* Close template picker on outside click */}
      {showTemplatePicker && (
        <div className="fixed inset-0 z-40" onClick={() => setShowTemplatePicker(false)} />
      )}
    </div>
  );
}
