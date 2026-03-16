/**
 * ProjectDashboardView — overview of active project with notes, stats, documents.
 * Mirrors ProjectDashboardView.swift.
 */
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, FileText, Save, X } from "lucide-react";
import { api, type ProjectNote } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import SmartTextEditor from "../components/SmartTextEditor";

export default function ProjectDashboardView() {
  const { activeWorkspaceId, activeProjectId, projects } = useWorkspaceStore();
  const project = projects.find((p) => p.id === activeProjectId);

  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [selectedNote, setSelectedNote] = useState<ProjectNote | null>(null);
  const [noteContent, setNoteContent] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    api.note.list(activeWorkspaceId).then(setNotes).catch(() => {});
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!selectedNote) return;
    setNoteContent(selectedNote.content ?? "");
    setNoteTitle(selectedNote.title);
  }, [selectedNote?.id]);

  // Auto-save
  useEffect(() => {
    if (!selectedNote) return;
    const t = setTimeout(saveCurrentNote, 1500);
    return () => clearTimeout(t);
  }, [noteContent, noteTitle]);

  async function saveCurrentNote() {
    if (!selectedNote) return;
    setSaving(true);
    try {
      await api.note.update(selectedNote.id, {
        title: noteTitle,
        content: noteContent,
      } as any);
      setNotes((prev) =>
        prev.map((n) => n.id === selectedNote.id ? { ...n, title: noteTitle, content: noteContent } : n)
      );
    } finally {
      setSaving(false);
    }
  }

  async function createNote() {
    if (!activeWorkspaceId) return;
    const note = await api.note.create(activeWorkspaceId, "Untitled Note");
    setNotes((prev) => [note, ...prev]);
    setSelectedNote(note);
  }

  async function deleteNote(id: string) {
    await api.note.delete(id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (selectedNote?.id === id) setSelectedNote(null);
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Notes list */}
      <div className="w-56 border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] flex flex-col">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-color)]">
          <span className="text-xs font-medium text-[var(--text-secondary)] truncate">
            {project?.name ?? "Notes"}
          </span>
          <button
            onClick={createNote}
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="New note"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {notes.length === 0 && (
            <p className="px-3 py-6 text-xs text-center text-[var(--text-muted)]">No notes yet</p>
          )}
          {notes.map((n) => (
            <div
              key={n.id}
              onClick={() => setSelectedNote(n)}
              className={`group flex items-center gap-1 px-3 py-2 cursor-pointer transition-colors ${
                selectedNote?.id === n.id
                  ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <FileText size={12} className="flex-shrink-0 opacity-60" />
              <span className="flex-1 text-xs truncate">{n.title || "Untitled"}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteNote(n.id); }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-red-400 transition-all"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedNote ? (
          <>
            <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--border-color)]">
              {editingTitle ? (
                <input
                  autoFocus
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  onBlur={() => setEditingTitle(false)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditingTitle(false); }}
                  className="flex-1 text-sm font-semibold text-[var(--text-primary)] bg-transparent border-b border-[var(--accent-color)] outline-none"
                />
              ) : (
                <h2
                  className="flex-1 text-sm font-semibold text-[var(--text-primary)] cursor-pointer truncate hover:text-[var(--accent-color)] transition-colors"
                  onClick={() => setEditingTitle(true)}
                  title="Click to rename"
                >
                  {noteTitle || "Untitled Note"}
                </h2>
              )}
              <span className="text-xs text-[var(--text-muted)]">{saving ? "Saving…" : "Saved"}</span>
              <button
                onClick={saveCurrentNote}
                className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
                title="Save"
              >
                <Save size={13} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <SmartTextEditor
                value={noteContent}
                onChange={setNoteContent}
                placeholder="Start writing… use [[concept names]] to link ideas"
                minHeight="calc(100vh - 160px)"
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-[var(--text-muted)] text-sm mb-3">
                {activeProjectId ? "Select a note or create one" : "Select a project first"}
              </p>
              {activeProjectId && (
                <button
                  onClick={createNote}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent-color)] text-white text-sm hover:opacity-90 mx-auto"
                >
                  <Plus size={14} /> New Note
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
