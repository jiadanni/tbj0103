/**
 * NoteEditorView — unified notes view with "Project Notes" and "Daily Notes" tabs.
 * Combines the former NoteEditorView and DailyNotesView into a single page.
 */
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Plus, Trash2, Tag, Search, FileText, Save, Calendar,
  ChevronLeft, ChevronRight, Flame, Star, CalendarPlus,
} from "lucide-react";
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameDay, subMonths, addMonths, addDays, subDays,
} from "date-fns";
import { api, type ProjectNote, type DailyNote, type NoteTemplate } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import SmartTextEditor from "../components/SmartTextEditor";

type NotesTab = "project" | "daily";

const NOTE_TYPES = ["manual", "ai_generated", "quiz"] as const;

// ── Mood options matching Swift's DailyNoteMetadataView ──
const MOOD_OPTIONS = [
  { emoji: "😔", label: "Down", value: 2 },
  { emoji: "😐", label: "Neutral", value: 4 },
  { emoji: "🙂", label: "Good", value: 6 },
  { emoji: "😊", label: "Great", value: 8 },
  { emoji: "🤩", label: "Amazing", value: 10 },
] as const;

function moodToEmoji(mood: number | undefined): string {
  if (mood === undefined) return "";
  const match = MOOD_OPTIONS.reduce((prev, curr) =>
    Math.abs(curr.value - mood) < Math.abs(prev.value - mood) ? curr : prev
  );
  return match.emoji;
}

export default function NoteEditorView() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const [activeTab, setActiveTab] = useState<NotesTab>("project");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] shrink-0">
        <button
          onClick={() => setActiveTab("project")}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
            activeTab === "project"
              ? "bg-[var(--accent-color)] text-white font-medium"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          }`}
        >
          <FileText size={13} /> Project Notes
        </button>
        <button
          onClick={() => setActiveTab("daily")}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
            activeTab === "daily"
              ? "bg-[var(--accent-color)] text-white font-medium"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          }`}
        >
          <Calendar size={13} /> Daily Notes
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "project" ? (
          <ProjectNotesPane workspaceId={activeWorkspaceId} />
        ) : (
          <DailyNotesPane workspaceId={activeWorkspaceId} />
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Project Notes Pane
// ═══════════════════════════════════════════════════════════════════════════

function ProjectNotesPane({ workspaceId }: { workspaceId: string | null }) {
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [selected, setSelected] = useState<ProjectNote | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  const filtered = notes.filter(
    (n) =>
      n.title.toLowerCase().includes(query.toLowerCase()) ||
      n.content.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    if (!workspaceId) return;
    api.note.list(workspaceId).then(setNotes).catch(() => {});
  }, [workspaceId]);

  useEffect(() => {
    if (!selected) return;
    setTitle(selected.title);
    setContent(selected.content);
    setTags(selected.tags ?? []);
  }, [selected?.id]);

  // Auto-save with 1.5s debounce
  const autoSave = useCallback(() => {
    if (!selected) return;
    setSaving(true);
    api.note
      .update(selected.id, { title, content, tags })
      .then(() => {
        setNotes((prev) =>
          prev.map((n) =>
            n.id === selected.id ? { ...n, title, content, tags, updated_at: new Date().toISOString() } : n
          )
        );
      })
      .finally(() => setSaving(false));
  }, [selected, title, content, tags]);

  useEffect(() => {
    if (!selected) return;
    const t = setTimeout(autoSave, 1500);
    return () => clearTimeout(t);
  }, [title, content, tags]);

  async function createNote() {
    if (!workspaceId || creating) return;
    setCreating(true);
    try {
      const note = await api.note.create(workspaceId, "Untitled Note");
      setNotes((prev) => [note, ...prev]);
      setSelected(note);
    } finally {
      setCreating(false);
    }
  }

  async function deleteNote(id: string) {
    if (!confirm("Delete this note?")) return;
    await api.note.delete(id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (selected?.id === id) setSelected(null);
  }

  function addTag() {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) return;
    setTags((prev) => [...prev, t]);
    setTagInput("");
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left pane: note list */}
      <div className="w-64 flex flex-col border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] shrink-0">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border-color)]">
          <div className="flex-1 flex items-center gap-1.5 bg-[var(--bg-elevated)] rounded-lg px-2 py-1">
            <Search size={12} className="text-[var(--text-muted)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes…"
              className="flex-1 text-xs bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
            />
          </div>
          <button
            onClick={createNote}
            disabled={!workspaceId || creating}
            title="New Note"
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--accent-color)] disabled:opacity-40 transition-colors"
          >
            <Plus size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="p-4 text-xs text-[var(--text-muted)] text-center">No notes yet. Click + to create one.</p>
          ) : (
            filtered.map((note) => (
              <button
                key={note.id}
                onClick={() => setSelected(note)}
                className={`w-full text-left px-3 py-2.5 border-b border-[var(--border-color)] transition-colors ${
                  selected?.id === note.id
                    ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                    : "hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
                }`}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{note.title || "Untitled"}</div>
                    <div className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
                      {note.content?.slice(0, 60) || "Empty note"}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteNote(note.id); }}
                    className="p-0.5 opacity-0 group-hover:opacity-100 hover:text-red-400 shrink-0"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
                {note.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {note.tags.slice(0, 3).map((t) => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-color)]/15 text-[var(--accent-color)]">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right pane: editor */}
      {selected ? (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Note header */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--border-color)] shrink-0">
            <FileText size={14} className="text-[var(--text-muted)]" />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Note title…"
              className="flex-1 text-sm font-medium bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
            />
            <span className="text-[11px] text-[var(--text-muted)] shrink-0">
              {saving ? "Saving…" : "Auto-saved"}
            </span>
            <button
              onClick={autoSave}
              className="p-1 hover:text-[var(--accent-color)] text-[var(--text-muted)] transition-colors"
              title="Save now"
            >
              <Save size={13} />
            </button>
            <button
              onClick={() => deleteNote(selected.id)}
              className="p-1 hover:text-red-400 text-[var(--text-muted)] transition-colors"
              title="Delete note"
            >
              <Trash2 size={13} />
            </button>
          </div>

          {/* Tag bar */}
          <div className="flex items-center gap-1.5 px-5 py-2 border-b border-[var(--border-color)] shrink-0 flex-wrap">
            <Tag size={11} className="text-[var(--text-muted)]" />
            {tags.map((t) => (
              <span
                key={t}
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
              >
                {t}
                <button onClick={() => setTags((prev) => prev.filter((x) => x !== t))} className="hover:text-red-400">×</button>
              </span>
            ))}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }}
              placeholder="Add tag…"
              className="text-[11px] bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none w-24"
            />
          </div>

          {/* Editor area */}
          <div className="flex-1 overflow-y-auto">
            <SmartTextEditor
              value={content}
              onChange={setContent}
              placeholder="Start writing…"
              minHeight="100%"
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
          <div className="text-center space-y-2">
            <FileText size={32} className="mx-auto opacity-30" />
            <p className="text-sm">Select a note to edit</p>
            {workspaceId && (
              <button
                onClick={createNote}
                className="text-xs text-[var(--accent-color)] hover:underline"
              >
                + Create new note
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Daily Notes Pane
// ═══════════════════════════════════════════════════════════════════════════

function DailyNotesPane({ workspaceId }: { workspaceId: string | null }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [note, setNote] = useState<DailyNote | null>(null);
  const [content, setContent] = useState("");
  const [mood, setMood] = useState<number | undefined>(undefined);
  const [productivity, setProductivity] = useState<number | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Calendar dot indicators
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

  // Stats
  const stats = useMemo(() => {
    const totalNotes = monthNotes.length;
    const prods = monthNotes.map((n) => n.productivity).filter((p): p is number => p != null);
    const avgProductivity = prods.length ? (prods.reduce((a, b) => a + b, 0) / prods.length) : 0;
    let streak = 0;
    let d = new Date();
    while (true) {
      const ds = format(d, "yyyy-MM-dd");
      if (datesWithNotes.has(ds)) { streak++; d = subDays(d, 1); } else { break; }
    }
    return { totalNotes, avgProductivity, streak };
  }, [monthNotes, datesWithNotes]);

  // Load month notes
  useEffect(() => {
    if (!workspaceId) return;
    const start = format(startOfMonth(currentMonth), "yyyy-MM-dd");
    const end = format(endOfMonth(currentMonth), "yyyy-MM-dd");
    api.note.listDailyNotesInRange(workspaceId, start, end)
      .then(setMonthNotes)
      .catch(() => {});
  }, [workspaceId, currentMonth]);

  // Load selected date note
  useEffect(() => {
    if (!workspaceId) return;
    const dateStr = format(selectedDate, "yyyy-MM-dd");
    api.note.getDailyNote(workspaceId, dateStr)
      .then((n) => {
        setNote(n);
        setContent(n.content ?? "");
        setMood(n.mood ?? undefined);
        setProductivity(n.productivity ?? undefined);
      })
      .catch(() => setNote(null));
  }, [workspaceId, selectedDate]);

  // Load templates
  useEffect(() => {
    if (!workspaceId) return;
    api.note.listTemplates(workspaceId).then(setTemplates).catch(() => {});
  }, [workspaceId]);

  // Auto-save debounce
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => saveNote(), 2000);
    return () => clearTimeout(t);
  }, [content, mood, productivity]);

  const saveNote = useCallback(async () => {
    if (!note) return;
    setSaving(true);
    try {
      await api.note.updateDailyNote(note.id, content, mood, productivity);
      setLastSaved(new Date());
      if (workspaceId) {
        const start = format(startOfMonth(currentMonth), "yyyy-MM-dd");
        const end = format(endOfMonth(currentMonth), "yyyy-MM-dd");
        api.note.listDailyNotesInRange(workspaceId, start, end)
          .then(setMonthNotes)
          .catch(() => {});
      }
    } finally {
      setSaving(false);
    }
  }, [note, content, mood, productivity, workspaceId, currentMonth]);

  async function applyTemplate(template: NoteTemplate) {
    try {
      const rendered = await api.note.applyTemplate(template.id);
      setContent(rendered);
    } catch { /* ignore */ }
    setShowTemplatePicker(false);
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Calendar sidebar */}
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
                  <span className={`block w-1 h-1 rounded-full mt-0.5 ${isSelected ? "bg-white" : "bg-[var(--accent-color)]"}`} />
                )}
              </button>
            );
          })}
        </div>

        {/* Mood selector */}
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
                      mood === opt.value ? "bg-[var(--accent-color)]/20 scale-110" : "opacity-50 hover:opacity-80"
                    }`}
                  >
                    {opt.emoji}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="text-[11px] text-[var(--text-muted)] block mb-1.5">Productivity</span>
              <div className="flex gap-1">
                {[1,2,3,4,5].map((level) => {
                  const filled = productivity !== undefined && (productivity / 2) >= level;
                  return (
                    <button key={level} onClick={() => setProductivity(level * 2)} className="transition-colors">
                      <Star size={16} className={filled ? "text-amber-400 fill-amber-400" : "text-[var(--text-muted)]"} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Stats panel */}
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

      {/* Editor panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header with day navigation */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/30">
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedDate((d) => subDays(d, 1))} className="p-1 hover:bg-[var(--bg-hover)] rounded">
              <ChevronLeft size={14} className="text-[var(--text-muted)]" />
            </button>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {format(selectedDate, "EEEE, MMMM d, yyyy")}
            </h2>
            <button onClick={() => setSelectedDate((d) => addDays(d, 1))} className="p-1 hover:bg-[var(--bg-hover)] rounded">
              <ChevronRight size={14} className="text-[var(--text-muted)]" />
            </button>
          </div>
          <div className="flex items-center gap-3">
            {mood !== undefined && <span className="text-sm">{moodToEmoji(mood)}</span>}
            {productivity !== undefined && (
              <div className="flex gap-0.5">
                {[1,2,3,4,5].map((l) => (
                  <Star key={l} size={12} className={(productivity / 2) >= l ? "text-amber-400 fill-amber-400" : "text-[var(--text-muted)]"} />
                ))}
              </div>
            )}
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
              <span className="text-[11px] text-[var(--text-muted)]">Saved {format(lastSaved, "HH:mm")}</span>
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

        {/* Editor or empty state */}
        <div className="flex-1 overflow-y-auto p-4">
          {!workspaceId ? (
            <p className="text-[var(--text-muted)] text-sm">Select a workspace to view daily notes.</p>
          ) : !note ? (
            <div className="flex flex-col items-center justify-center h-full gap-5 text-center">
              <CalendarPlus size={56} className="text-[var(--accent-color)] opacity-70" />
              <div>
                <p className="text-base font-medium text-[var(--text-primary)]">No daily note for this day</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">Select a date or click below to create one.</p>
              </div>
              <button
                onClick={() => {
                  if (!workspaceId) return;
                  const dateStr = format(selectedDate, "yyyy-MM-dd");
                  api.note.getDailyNote(workspaceId, dateStr).then((n) => {
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
          ) : (
            <SmartTextEditor
              value={content}
              onChange={setContent}
              placeholder="How was your day? Use [[concept]] to link ideas…"
              minHeight="calc(100vh - 220px)"
            />
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
