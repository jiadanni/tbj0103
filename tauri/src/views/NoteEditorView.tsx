/**
 * NoteEditorView — browse and edit project notes with full CRUD.
 * Includes internal tabs for Workspace Notes and Daily Notes.
 */
import { useEffect, useState, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { Plus, Trash2, Tag, Search, FileText, Save, Calendar, Sparkles, Loader } from "lucide-react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { message } from "@tauri-apps/plugin-dialog";
import { api, type ProjectNote } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useScopedWorkspace, useBubbleUpFlag } from "../lib/workspacePane";
import SmartTextEditor from "../components/SmartTextEditor";
import { Tooltip } from "../components/Tooltip";
import DailyNotesView from "./DailyNotesView";
import type { NotesSubView } from "../components/navigationItems";

type NoteSurfaceSelection =
  | { kind: "daily" }
  | { kind: "note"; noteId: string | null };

export default function NoteEditorView() {
  const location = useLocation();
  const [selection, setSelection] = useState<NoteSurfaceSelection>({ kind: "note", noteId: null });

  // Handle external subview switching via router state.
  useEffect(() => {
    const state = location.state as { subView?: NotesSubView } | null;
    if (state?.subView) {
      setSelection(state.subView === "daily" ? { kind: "daily" } : { kind: "note", noteId: null });
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);
  const { activeWorkspaceId } = useScopedWorkspace();
  const includeDescendants = useBubbleUpFlag();
  const isDemoMode = useWorkspaceStore((state) => state.isDemoMode);
  const preferredModel = useSettingsStore((s) => s.preferredModel);
  const ollamaUrl = useSettingsStore((s) => s.ollamaUrl);
  const [generatingFlashcards, setGeneratingFlashcards] = useState(false);
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
    if (!activeWorkspaceId) {return;}
    api.note.list(activeWorkspaceId, { limit: 200, offset: 0, includeDescendants }).then(setNotes).catch(() => {});
  }, [activeWorkspaceId, includeDescendants]);

  useEffect(() => {
    if (!selected) {return;}
    setTitle(selected.title);
    setContent(selected.content);
    setTags(selected.tags ?? []);
  }, [selected]);

  useEffect(() => {
    if (selection.kind !== "note" || !selection.noteId) {return;}
    const match = notes.find((note) => note.id === selection.noteId) ?? null;
    setSelected(match);
  }, [notes, selection]);

  // Auto-save with 1.5s debounce
  const autoSave = useCallback(() => {
    if (!selected) {return;}
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
    if (!selected) {return;}
    const t = setTimeout(autoSave, 1500);
    return () => clearTimeout(t);
  }, [title, content, tags, autoSave, selected]);

  async function createNote() {
    if (!activeWorkspaceId || creating) {return;}
    setCreating(true);
    try {
      const note = await api.note.create(activeWorkspaceId, "Untitled Note");
      setNotes((prev) => [note, ...prev]);
      setSelected(note);
      setSelection({ kind: "note", noteId: note.id });
    } finally {
      setCreating(false);
    }
  }

  async function deleteNote(id: string) {
    if (isDemoMode) {
      await message("Note deletion is not available in Demo Mode.", { title: "Demo Mode" });
      return;
    }
    if (!await confirm("Delete this note?", {
      title: "Delete note?",
      kind: "warning",
    })) {return;}
    await api.note.delete(id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (selected?.id === id) {
      setSelected(null);
      setSelection({ kind: "note", noteId: null });
    }
  }

  function addTag() {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) {return;}
    setTags((prev) => [...prev, t]);
    setTagInput("");
  }

  async function generateFlashcardsFromNote() {
    if (!activeWorkspaceId || !preferredModel || !selected || content.length < 50) { return; }
    setGeneratingFlashcards(true);
    try {
      const cards = await api.flashcard.extractFromContent(
        activeWorkspaceId, content, "note", preferredModel, selected.id, ollamaUrl || undefined
      );
      if (cards.length > 0) {
        await message(`Generated ${cards.length} flashcard${cards.length !== 1 ? "s" : ""} from this note.`, { title: "Flashcards" });
      } else {
        await message("No flashcards could be extracted from this note.", { title: "Flashcards" });
      }
    } catch {
      await message("Failed to generate flashcards. Make sure Ollama is running.", { title: "Error" });
    } finally {
      setGeneratingFlashcards(false);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left pane: note list */}
      <div className="w-72 flex flex-col border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] shrink-0">
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
          <Tooltip content="New Note">
            <button
              onClick={createNote}
              disabled={!activeWorkspaceId || creating}
              className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--accent-color)] disabled:opacity-40 transition-colors"
            >
              <Plus size={14} />
            </button>
          </Tooltip>
        </div>

        <div className="border-b border-[var(--border-color)] px-2 py-2">
          <button
            onClick={() => {
              setSelection({ kind: "daily" });
              setSelected(null);
            }}
            className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium transition-colors ${
              selection.kind === "daily"
                ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            <Calendar size={14} />
            <div>
              <div>Calendar</div>
              <div className="text-[10px] text-[var(--text-muted)]">Browse notes by day</div>
            </div>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-3 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Notes
          </div>
          {!activeWorkspaceId ? (
            <p className="p-4 text-xs text-[var(--text-muted)] text-center">Select a workspace to view notes.</p>
          ) : filtered.length === 0 ? (
            <p className="p-4 text-xs text-[var(--text-muted)] text-center">No notes yet. Click + to create one.</p>
          ) : (
            filtered.map((note) => (
              <div
                key={note.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setSelected(note);
                  setSelection({ kind: "note", noteId: note.id });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected(note);
                    setSelection({ kind: "note", noteId: note.id });
                  }
                }}
                className={`w-full text-left px-3 py-2.5 border-b border-[var(--border-color)] transition-colors ${
                  selection.kind === "note" && selected?.id === note.id
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
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right pane: editor */}
      {selection.kind === "daily" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <DailyNotesView />
        </div>
      ) : selected ? (
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
            <Tooltip content="Save now">
              <button
                onClick={autoSave}
                className="p-1 hover:text-[var(--accent-color)] text-[var(--text-muted)] transition-colors"
              >
                <Save size={13} />
              </button>
            </Tooltip>
            <Tooltip content="Generate flashcards from note">
              <button
                onClick={generateFlashcardsFromNote}
                disabled={generatingFlashcards || !preferredModel || content.length < 50}
                className="p-1 hover:text-[var(--accent-color)] text-[var(--text-muted)] transition-colors disabled:opacity-40"
              >
                {generatingFlashcards ? <Loader size={13} className="animate-spin" /> : <Sparkles size={13} />}
              </button>
            </Tooltip>
            <Tooltip content="Delete note">
              <button
                onClick={() => deleteNote(selected.id)}
                className="p-1 hover:text-red-400 text-[var(--text-muted)] transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </Tooltip>
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
            {activeWorkspaceId && (
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
    </div>
  );
}
