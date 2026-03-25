/**
 * NoteEditorView — browse and edit project notes with full CRUD.
 * Mirrors NoteEditorView.swift: list pane on left, editor on right.
 */
import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, Tag, Search, FileText, Save } from "lucide-react";
import { api, type ProjectNote } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import SmartTextEditor from "../components/SmartTextEditor";

export default function NoteEditorView() {
  const { activeProjectId } = useWorkspaceStore();
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
    if (!activeProjectId) {return;}
    api.note.list(activeProjectId).then(setNotes).catch(() => {});
  }, [activeProjectId]);

  useEffect(() => {
    if (!selected) {return;}
    setTitle(selected.title);
    setContent(selected.content);
    setTags(selected.tags ?? []);
  }, [selected]);

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
    if (!activeProjectId || creating) {return;}
    setCreating(true);
    try {
      const note = await api.note.create(activeProjectId, "Untitled Note");
      setNotes((prev) => [note, ...prev]);
      setSelected(note);
    } finally {
      setCreating(false);
    }
  }

  async function deleteNote(id: string) {
    if (!confirm("Delete this note?")) {return;}
    await api.note.delete(id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (selected?.id === id) {setSelected(null);}
  }

  function addTag() {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) {return;}
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
            disabled={!activeProjectId || creating}
            title="New Note"
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--accent-color)] disabled:opacity-40 transition-colors"
          >
            <Plus size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!activeProjectId ? (
            <p className="p-4 text-xs text-[var(--text-muted)] text-center">Select a project to view notes.</p>
          ) : filtered.length === 0 ? (
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
            {activeProjectId && (
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
