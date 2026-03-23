import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Calendar,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  FileText,
  Flame,
  Plus,
  Save,
  Search,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import { addDays, format, subDays } from "date-fns";
import { api, type DailyNote, type NoteTemplate, type ProjectNote } from "../lib/api";
import SmartTextEditor from "../components/SmartTextEditor";
import { useScopedWorkspace } from "../lib/workspacePane";

type Selection =
  | { kind: "project"; id: string }
  | { kind: "daily"; date: string };

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

export default function NoteEditorView() {
  const { activeWorkspaceId, noteSelection, setNoteSelection } = useScopedWorkspace();
  const [projectNotes, setProjectNotes] = useState<ProjectNote[]>([]);
  const [recentDailyNotes, setRecentDailyNotes] = useState<DailyNote[]>([]);
  const [selection, setSelection] = useState<Selection | null>(noteSelection
    ? noteSelection.kind === "project"
      ? { kind: "project", id: noteSelection.id ?? "" }
      : { kind: "daily", date: noteSelection.date ?? format(new Date(), "yyyy-MM-dd") }
    : null);
  const [query, setQuery] = useState("");
  const [dailyDateInput, setDailyDateInput] = useState(format(new Date(), "yyyy-MM-dd"));
  const [creating, setCreating] = useState(false);

  const loadProjectNotes = useCallback(() => {
    if (!activeWorkspaceId) {return;}
    api.note.list(activeWorkspaceId).then(setProjectNotes).catch(() => {});
  }, [activeWorkspaceId]);

  const loadRecentDailyNotes = useCallback(() => {
    if (!activeWorkspaceId) {return;}
    const end = format(new Date(), "yyyy-MM-dd");
    const start = format(subDays(new Date(), 29), "yyyy-MM-dd");
    api.note.listDailyNotesInRange(activeWorkspaceId, start, end)
      .then((notes) => setRecentDailyNotes(notes.slice().reverse()))
      .catch(() => {});
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!activeWorkspaceId) {return;}
    loadProjectNotes();
    loadRecentDailyNotes();
    setDailyDateInput(format(new Date(), "yyyy-MM-dd"));
    setSelection({ kind: "daily", date: format(new Date(), "yyyy-MM-dd") });
  }, [activeWorkspaceId, loadProjectNotes, loadRecentDailyNotes]);

  useEffect(() => {
    if (!selection) {
      setNoteSelection(null);
      return;
    }

    if (selection.kind === "project") {
      setNoteSelection({ kind: "project", id: selection.id });
      return;
    }

    setNoteSelection({ kind: "daily", date: selection.date });
  }, [selection, setNoteSelection]);

  const filteredProjectNotes = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {return projectNotes;}
    return projectNotes.filter((note) =>
      note.title.toLowerCase().includes(trimmed) ||
      note.content.toLowerCase().includes(trimmed) ||
      (note.tags ?? []).some((tag) => tag.toLowerCase().includes(trimmed))
    );
  }, [projectNotes, query]);

  async function createNote() {
    if (!activeWorkspaceId || creating) {return;}
    setCreating(true);
    try {
      const note = await api.note.create(activeWorkspaceId, "Untitled Note");
      setProjectNotes((prev) => [note, ...prev]);
      setSelection({ kind: "project", id: note.id });
    } finally {
      setCreating(false);
    }
  }

  function openDailyNote(date: string) {
    setDailyDateInput(date);
    setSelection({ kind: "daily", date });
  }

  const selectedProjectNote = selection?.kind === "project"
    ? projectNotes.find((note) => note.id === selection.id) ?? null
    : null;

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="w-72 flex flex-col border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] shrink-0">
        <div className="px-4 py-3 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--accent-color)]/15 text-[var(--accent-color)] flex items-center justify-center">
              <FileText size={18} />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-[var(--text-primary)]">Notes</h1>
              <p className="text-[11px] text-[var(--text-muted)]">Daily notes and workspace notes together</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-1.5 bg-[var(--bg-elevated)] rounded-lg px-2 py-1.5">
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
              disabled={!activeWorkspaceId || creating}
              title="New Note"
              className="p-2 rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2 mb-2">
            <Calendar size={13} className="text-[var(--text-muted)]" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Daily Notes</span>
          </div>

          <div className="flex gap-2 mb-2">
            <input
              type="date"
              value={dailyDateInput}
              onChange={(e) => {
                setDailyDateInput(e.target.value);
                if (e.target.value) {openDailyNote(e.target.value);}
              }}
              className="flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
            />
            <button
              onClick={() => openDailyNote(format(new Date(), "yyyy-MM-dd"))}
              className="px-3 py-2 rounded-lg border border-[var(--border-color)] text-xs text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--accent-color)] transition-colors"
            >
              Today
            </button>
          </div>

          <div className="space-y-1 max-h-56 overflow-y-auto">
            {recentDailyNotes.length === 0 ? (
              <button
                onClick={() => openDailyNote(format(new Date(), "yyyy-MM-dd"))}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-[var(--border-color)] text-xs text-[var(--text-muted)] hover:border-[var(--accent-color)] hover:text-[var(--accent-color)] transition-colors"
              >
                <CalendarPlus size={13} />
                Create today&apos;s note
              </button>
            ) : (
              recentDailyNotes.map((note) => (
                <button
                  key={note.id}
                  onClick={() => openDailyNote(note.date)}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                    selection?.kind === "daily" && selection.date === note.date
                      ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                      : "hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{format(new Date(note.date), "EEE, MMM d")}</span>
                    <span className="text-sm">{moodToEmoji(note.mood ?? undefined)}</span>
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
                    {note.content?.slice(0, 56) || "Empty daily note"}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          <div className="px-4 py-3">
            <div className="flex items-center gap-2">
              <FileText size={13} className="text-[var(--text-muted)]" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Workspace Notes</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {filteredProjectNotes.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-[var(--text-muted)]">
                No notes matched your search.
              </div>
            ) : (
              filteredProjectNotes.map((note) => (
                <button
                  key={note.id}
                  onClick={() => setSelection({ kind: "project", id: note.id })}
                  className={`w-full text-left px-3 py-2.5 rounded-xl mb-1 transition-colors ${
                    selection?.kind === "project" && selection.id === note.id
                      ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                      : "hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
                  }`}
                >
                  <div className="text-xs font-medium truncate">{note.title || "Untitled"}</div>
                  <div className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
                    {note.content?.slice(0, 64) || "Empty note"}
                  </div>
                  {note.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {note.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-hidden">
        {!activeWorkspaceId ? (
          <div className="h-full flex items-center justify-center text-[var(--text-muted)]">
            Select a workspace to view notes.
          </div>
        ) : selection?.kind === "daily" ? (
          <DailyNoteEditor
            workspaceId={activeWorkspaceId}
            date={selection.date}
            onDateChange={(date) => openDailyNote(date)}
            onSaved={loadRecentDailyNotes}
          />
        ) : selectedProjectNote ? (
          <ProjectNoteEditor
            note={selectedProjectNote}
            onDeleted={(id) => {
              setProjectNotes((prev) => prev.filter((note) => note.id !== id));
              setSelection({ kind: "daily", date: format(new Date(), "yyyy-MM-dd") });
            }}
            onUpdated={(updated) => {
              setProjectNotes((prev) => prev.map((note) => note.id === updated.id ? updated : note));
            }}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-[var(--text-muted)]">
            Select a note to start editing.
          </div>
        )}
      </main>
    </div>
  );
}

function ProjectNoteEditor({
  note,
  onDeleted,
  onUpdated,
}: {
  note: ProjectNote;
  onDeleted: (id: string) => void;
  onUpdated: (note: ProjectNote) => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [tags, setTags] = useState<string[]>(note.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(note.title);
    setContent(note.content);
    setTags(note.tags ?? []);
  }, [note.id, note.title, note.content, note.tags]);

  const saveNote = useCallback(async () => {
    setSaving(true);
    try {
      await api.note.update(note.id, { title, content, tags });
      onUpdated({ ...note, title, content, tags, updated_at: new Date().toISOString() });
    } finally {
      setSaving(false);
    }
  }, [content, note, onUpdated, tags, title]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void saveNote();
    }, 1500);
    return () => window.clearTimeout(timeoutId);
  }, [title, content, tags, saveNote]);

  function addTag() {
    const trimmed = tagInput.trim();
    if (!trimmed || tags.includes(trimmed)) {return;}
    setTags((prev) => [...prev, trimmed]);
    setTagInput("");
  }

  async function deleteNote() {
    if (!await confirm("Delete this note?")) {return;}
    await api.note.delete(note.id);
    onDeleted(note.id);
  }

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden">
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
          onClick={() => void saveNote()}
          className="p-1 hover:text-[var(--accent-color)] text-[var(--text-muted)] transition-colors"
          title="Save now"
        >
          <Save size={13} />
        </button>
        <button
          onClick={() => void deleteNote()}
          className="p-1 hover:text-red-400 text-[var(--text-muted)] transition-colors"
          title="Delete note"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="flex items-center gap-1.5 px-5 py-2 border-b border-[var(--border-color)] shrink-0 flex-wrap">
        <Tag size={11} className="text-[var(--text-muted)]" />
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
          >
            {tag}
            <button onClick={() => setTags((prev) => prev.filter((value) => value !== tag))} className="hover:text-red-400">x</button>
          </span>
        ))}
        <input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder="Add tag…"
          className="text-[11px] bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none w-24"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        <SmartTextEditor
          value={content}
          onChange={setContent}
          placeholder="Start writing…"
          minHeight="100%"
        />
      </div>
    </div>
  );
}

function DailyNoteEditor({
  workspaceId,
  date,
  onDateChange,
  onSaved,
}: {
  workspaceId: string;
  date: string;
  onDateChange: (date: string) => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState<DailyNote | null>(null);
  const [content, setContent] = useState("");
  const [mood, setMood] = useState<number | undefined>(undefined);
  const [productivity, setProductivity] = useState<number | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [templates, setTemplates] = useState<NoteTemplate[]>([]);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  useEffect(() => {
    api.note.getDailyNote(workspaceId, date)
      .then((nextNote) => {
        setNote(nextNote);
        setContent(nextNote.content ?? "");
        setMood(nextNote.mood ?? undefined);
        setProductivity(nextNote.productivity ?? undefined);
      })
      .catch(() => setNote(null));
  }, [workspaceId, date]);

  useEffect(() => {
    api.note.listTemplates(workspaceId).then(setTemplates).catch(() => {});
  }, [workspaceId]);

  const saveNote = useCallback(async () => {
    if (!note) {return;}
    setSaving(true);
    try {
      await api.note.updateDailyNote(note.id, content, mood, productivity);
      setLastSaved(new Date());
      onSaved();
    } finally {
      setSaving(false);
    }
  }, [content, mood, note, onSaved, productivity]);

  useEffect(() => {
    if (!note) {return;}
    const timeoutId = window.setTimeout(() => {
      void saveNote();
    }, 2000);
    return () => window.clearTimeout(timeoutId);
  }, [content, mood, productivity, note, saveNote]);

  async function applyTemplate(template: NoteTemplate) {
    try {
      const rendered = await api.note.applyTemplate(template.id);
      setContent(rendered);
    } catch {
      // ignore
    }
    setShowTemplatePicker(false);
  }

  const currentDate = new Date(date);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/30 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onDateChange(format(subDays(currentDate, 1), "yyyy-MM-dd"))}
            className="p-1 hover:bg-[var(--bg-hover)] rounded"
          >
            <ChevronLeft size={14} className="text-[var(--text-muted)]" />
          </button>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {format(currentDate, "EEEE, MMMM d, yyyy")}
          </h2>
          <button
            onClick={() => onDateChange(format(addDays(currentDate, 1), "yyyy-MM-dd"))}
            className="p-1 hover:bg-[var(--bg-hover)] rounded"
          >
            <ChevronRight size={14} className="text-[var(--text-muted)]" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          {mood !== undefined && <span className="text-sm">{moodToEmoji(mood)}</span>}
          {productivity !== undefined && (
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((level) => (
                <Star
                  key={level}
                  size={12}
                  className={(productivity / 2) >= level ? "text-amber-400 fill-amber-400" : "text-[var(--text-muted)]"}
                />
              ))}
            </div>
          )}
          <div className="relative">
            <button
              onClick={() => setShowTemplatePicker((open) => !open)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-[var(--border-color)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
            >
              <FileText size={12} /> Template
            </button>
            {showTemplatePicker && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg shadow-lg z-50 py-1 max-h-64 overflow-y-auto">
                {templates.length === 0 && (
                  <div className="px-3 py-2 text-xs text-[var(--text-muted)]">No templates</div>
                )}
                {templates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => void applyTemplate(template)}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
                  >
                    {template.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {lastSaved && (
            <span className="text-[11px] text-[var(--text-muted)]">Saved {format(lastSaved, "HH:mm")}</span>
          )}
          <button
            onClick={() => void saveNote()}
            disabled={saving}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-[var(--accent-color)] text-white disabled:opacity-50 hover:opacity-90"
          >
            <Save size={12} /> Save
          </button>
        </div>
      </div>

      <div className="px-5 py-3 border-b border-[var(--border-color)] flex items-center justify-between gap-4 shrink-0">
        <div>
          <div className="text-[11px] text-[var(--text-muted)] mb-1.5">Mood</div>
          <div className="flex gap-1">
            {MOOD_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setMood(option.value)}
                title={option.label}
                className={`text-lg rounded-md p-1 transition-all ${
                  mood === option.value ? "bg-[var(--accent-color)]/20 scale-110" : "opacity-50 hover:opacity-80"
                }`}
              >
                {option.emoji}
              </button>
            ))}
          </div>
        </div>
        <div className="ml-auto">
          <div className="text-[11px] text-[var(--text-muted)] mb-1.5">Productivity</div>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((level) => {
              const filled = productivity !== undefined && (productivity / 2) >= level;
              return (
                <button key={level} onClick={() => setProductivity(level * 2)} className="transition-colors">
                  <Star size={16} className={filled ? "text-amber-400 fill-amber-400" : "text-[var(--text-muted)]"} />
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <Flame size={14} className="text-orange-400" />
          Daily capture
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!note ? (
          <div className="h-full flex items-center justify-center text-[var(--text-muted)]">
            Loading daily note…
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

      {showTemplatePicker && (
        <div className="fixed inset-0 z-40" onClick={() => setShowTemplatePicker(false)} />
      )}
    </div>
  );
}
