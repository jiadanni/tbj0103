/**
 * NoteEditorView — unified library for notes and sources.
 *
 * Top: centered "Take a note…" composer that expands on focus.
 * Body: masonry of fixed-width cards (notes + sources) using CSS columns.
 * Click a card → expanded modal editor (notes editable; sources show detail).
 */
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Plus, Trash2, Tag, Pin, FileText, Save, Sparkles, Loader,
  Upload, Globe, Cpu, X, ExternalLink, File, Search,
} from "lucide-react";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { api, type ProjectNote, type Source } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useScopedWorkspace, useBubbleUpFlag } from "../lib/workspacePane";
import SmartTextEditor from "../components/SmartTextEditor";
import { Tooltip } from "../components/Tooltip";

// ── Unified item model ──────────────────────────────────────────────────

type WorkspaceItem =
  | { kind: "note"; id: string; title: string; updatedAt: string; note: ProjectNote }
  | { kind: "source"; id: string; title: string; updatedAt: string; source: Source };

function itemFromNote(n: ProjectNote): WorkspaceItem {
  return { kind: "note", id: n.id, title: n.title || "Untitled", updatedAt: n.updated_at, note: n };
}
function itemFromSource(s: Source): WorkspaceItem {
  return {
    kind: "source", id: s.id,
    title: s.title || s.filename || s.url || "Untitled",
    updatedAt: s.updated_at, source: s,
  };
}

function formatTokens(n?: number | null): string {
  if (n == null || n === 0) { return ""; }
  if (n >= 1000) { return `${(n / 1000).toFixed(0)}K tokens`; }
  return `${n} tokens`;
}

// ── Composer ────────────────────────────────────────────────────────────

interface ComposerProps {
  onCreate: (fields: { title: string; content: string; tags: string[]; isPinned: boolean }) => Promise<void>;
  onUpload: () => void;
  onWebCapture: () => void;
  disabled?: boolean;
}

function Composer({ onCreate, onUpload, onWebCapture, disabled }: ComposerProps) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(async () => {
    if ((title.trim() || content.trim()) && !disabled) {
      await onCreate({ title: title.trim(), content: content.trim(), tags, isPinned });
    }
    setTitle(""); setContent(""); setTags([]); setTagInput("");
    setIsPinned(false);
    setExpanded(false);
  }, [title, content, tags, isPinned, onCreate, disabled]);

  useEffect(() => {
    if (!expanded) { return; }
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { void close(); }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [expanded, close]);

  function addTag() {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) { return; }
    setTags((prev) => [...prev, t]);
    setTagInput("");
  }

  return (
    <div className="w-full flex justify-center pt-6 pb-4 px-4">
      <div
        ref={ref}
        className="w-full max-w-2xl bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-lg shadow-sm hover:shadow-md transition-shadow"
      >
        {expanded ? (
          <div className="flex flex-col">
            <div className="flex items-center px-4 pt-3 pb-1">
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                className="flex-1 text-sm font-medium bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
              />
              <button
                type="button"
                aria-label={isPinned ? "Unpin draft note" : "Pin draft note"}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsPinned((prev) => !prev);
                }}
                className={`p-1 ${isPinned ? "text-[var(--accent-color)]" : "text-[var(--text-muted)] hover:text-[var(--accent-color)]"}`}
              >
                <Pin size={14} />
              </button>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Take a note…"
              rows={3}
              className="w-full px-4 py-2 text-sm bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none resize-none"
            />
            {tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
                {tags.map((t) => (
                  <span key={t} className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[var(--accent-color)]/15 text-[var(--accent-color)]">
                    {t}
                    <button onClick={() => setTags((prev) => prev.filter((x) => x !== t))} className="hover:text-red-400">×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1 px-2 py-1 border-t border-[var(--border-color)]">
              <Tooltip content="Upload document">
                <button onClick={onUpload} disabled={disabled} className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] disabled:opacity-40">
                  <Upload size={13} />
                </button>
              </Tooltip>
              <Tooltip content="Add web capture">
                <button onClick={onWebCapture} disabled={disabled} className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] disabled:opacity-40">
                  <Globe size={13} />
                </button>
              </Tooltip>
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }}
                placeholder="Add tag…"
                className="ml-1 px-2 py-1 text-[11px] bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none w-28"
              />
              <button
                onClick={close}
                className="ml-auto px-3 py-1 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] rounded"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setExpanded(true)}
            disabled={disabled}
            className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-[var(--text-muted)] hover:bg-[var(--bg-hover)] rounded-lg disabled:opacity-50"
          >
            <span className="flex-1">Take a note…</span>
            <span className="flex items-center gap-2 text-[var(--text-muted)]">
              <Tooltip content="Upload document">
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); if (!disabled) { onUpload(); } }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); if (!disabled) { onUpload(); } } }}
                  className="p-1 rounded hover:bg-[var(--bg-elevated)]"
                >
                  <Upload size={14} />
                </span>
              </Tooltip>
              <Tooltip content="Add web capture">
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); if (!disabled) { onWebCapture(); } }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); if (!disabled) { onWebCapture(); } } }}
                  className="p-1 rounded hover:bg-[var(--bg-elevated)]"
                >
                  <Globe size={14} />
                </span>
              </Tooltip>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Card ────────────────────────────────────────────────────────────────

interface CardProps {
  item: WorkspaceItem;
  onClick: () => void;
  onDelete: () => void;
  onProcessSource?: () => void;
  processing?: boolean;
}

function NoteCard({ item, onClick, onDelete, onProcessSource, processing }: CardProps) {
  return (
    <div
      onClick={onClick}
      className="group break-inside-avoid mb-4 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-lg p-3 cursor-pointer hover:shadow-md hover:border-[var(--text-muted)] transition-all"
    >
      {item.kind === "note" ? (
        <>
          {item.note.title && (
            <div className="flex items-start gap-1.5 mb-1.5">
              <div className="text-sm font-medium text-[var(--text-primary)] line-clamp-2 flex-1">
                {item.note.title}
              </div>
              {item.note.is_pinned && (
                <Pin size={11} className="text-[var(--accent-color)] shrink-0 mt-0.5" />
              )}
            </div>
          )}
          {!item.note.title && item.note.is_pinned && (
            <div className="flex justify-end mb-1.5">
              <Pin size={11} className="text-[var(--accent-color)] shrink-0" />
            </div>
          )}
          {item.note.content && (
            <div className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap line-clamp-[12]">
              {item.note.content}
            </div>
          )}
          {item.note.tags && item.note.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {item.note.tags.slice(0, 5).map((t) => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-hover)] text-[var(--text-muted)]">
                  {t}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5 mb-1.5">
            {item.source.source_type === "document"
              ? <File size={11} className="text-blue-400/70" />
              : <Globe size={11} className="text-green-400/70" />}
            <span className={`text-[9px] px-1 py-0.5 rounded uppercase tracking-wider ${
              item.source.source_type === "document"
                ? "bg-blue-500/10 text-blue-400"
                : "bg-green-500/10 text-green-400"
            }`}>
              {item.source.source_type === "document" ? "Doc" : "Web"}
            </span>
            {item.source.is_processed && (
              <span className="text-[9px] text-green-400">{item.source.chunk_count ?? 0} chunks</span>
            )}
          </div>
          <div className="text-sm font-medium text-[var(--text-primary)] mb-1.5 line-clamp-2">
            {item.title}
          </div>
          {item.source.summary ? (
            <div className="text-xs text-[var(--text-secondary)] line-clamp-[10]">{item.source.summary}</div>
          ) : item.source.content ? (
            <div className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap line-clamp-[10]">
              {item.source.content.slice(0, 400)}
            </div>
          ) : null}
          <div className="flex items-center gap-2 mt-2 text-[10px] text-[var(--text-muted)]">
            {item.source.token_count != null && item.source.token_count > 0 && (
              <span>{formatTokens(item.source.token_count)}</span>
            )}
            {item.source.url && <span className="truncate flex-1 min-w-0">{item.source.url}</span>}
          </div>
        </>
      )}

      {/* Hover actions */}
      <div
        className="flex items-center gap-0.5 mt-2 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        {item.kind === "source" && !item.source.is_processed && onProcessSource && (
          <Tooltip content="Process">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onProcessSource();
              }}
              disabled={processing}
              className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
            >
              {processing ? <Loader size={11} className="animate-spin" /> : <Cpu size={11} />}
            </button>
          </Tooltip>
        )}
        <Tooltip content="Delete">
          <button
            type="button"
            aria-label={`Delete ${item.kind}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-red-400"
          >
            <Trash2 size={11} />
          </button>
        </Tooltip>
        <span className="ml-auto text-[9px] text-[var(--text-muted)]">
          {new Date(item.updatedAt).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}

// ── Note edit modal ─────────────────────────────────────────────────────

interface NoteModalProps {
  note: ProjectNote;
  saving: boolean;
  onChange: (fields: { title: string; content: string; tags: string[]; is_pinned: boolean }) => void;
  onClose: () => void;
  onDelete: () => void;
  onGenerateFlashcards: () => void;
  generatingFlashcards: boolean;
  canGenerateFlashcards: boolean;
}

function NoteModal({
  note, saving, onChange, onClose, onDelete, onGenerateFlashcards, generatingFlashcards, canGenerateFlashcards,
}: NoteModalProps) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [tags, setTags] = useState<string[]>(note.tags ?? []);
  const [isPinned, setIsPinned] = useState(note.is_pinned);
  const [tagInput, setTagInput] = useState("");

  // Push edits up — parent debounces & persists.
  useEffect(() => { onChange({ title, content, tags, is_pinned: isPinned }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, tags, isPinned]);

  function addTag() {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) { return; }
    setTags((prev) => [...prev, t]);
    setTagInput("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-6" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-xl shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--border-color)]">
          <FileText size={14} className="text-[var(--text-muted)]" />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="flex-1 text-sm font-medium bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
          <span className="text-[11px] text-[var(--text-muted)] shrink-0">{saving ? "Saving…" : "Saved"}</span>
          <Tooltip content="Save now">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange({ title, content, tags, is_pinned: isPinned });
              }}
              className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-color)]"
            >
              <Save size={13} />
            </button>
          </Tooltip>
          <Tooltip content={isPinned ? "Unpin note" : "Pin note"}>
            <button
              type="button"
              aria-label={isPinned ? "Unpin note" : "Pin note"}
              onClick={(e) => {
                e.stopPropagation();
                setIsPinned((prev) => !prev);
              }}
              className={`p-1 ${isPinned ? "text-[var(--accent-color)]" : "text-[var(--text-muted)] hover:text-[var(--accent-color)]"}`}
            >
              <Pin size={13} />
            </button>
          </Tooltip>
          <Tooltip content="Generate flashcards">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onGenerateFlashcards();
              }}
              disabled={generatingFlashcards || !canGenerateFlashcards || content.length < 50}
              className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-color)] disabled:opacity-40"
            >
              {generatingFlashcards ? <Loader size={13} className="animate-spin" /> : <Sparkles size={13} />}
            </button>
          </Tooltip>
          <Tooltip content="Delete note">
            <button
              type="button"
              aria-label="Delete note"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-1 text-[var(--text-muted)] hover:text-red-400"
            >
              <Trash2 size={13} />
            </button>
          </Tooltip>
          <button
            type="button"
            aria-label="Close note"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex items-center gap-1.5 px-5 py-2 border-b border-[var(--border-color)] flex-wrap">
          <Tag size={11} className="text-[var(--text-muted)]" />
          {tags.map((t) => (
            <span key={t} className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[var(--accent-color)]/15 text-[var(--accent-color)]">
              {t}
              <button
                type="button"
                aria-label={`Remove tag ${t}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setTags((prev) => prev.filter((x) => x !== t));
                }}
                className="hover:text-red-400"
              >
                ×
              </button>
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

        <div className="flex-1 overflow-y-auto min-h-0">
          <SmartTextEditor value={content} onChange={setContent} placeholder="Take a note…" minHeight="300px" />
        </div>
      </div>
    </div>
  );
}

// ── Source detail modal ────────────────────────────────────────────────

function SourceModal({
  source, onClose, onDelete, onProcess, processing,
}: {
  source: Source;
  onClose: () => void;
  onDelete: () => void;
  onProcess: () => void;
  processing: boolean;
}) {
  function formatBytes(n: number) {
    if (n < 1024) { return `${n} B`; }
    if (n < 1024 * 1024) { return `${(n / 1024).toFixed(1)} KB`; }
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-6" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-xl shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--border-color)]">
          {source.source_type === "document" ? <File size={14} /> : <Globe size={14} />}
          <h2 className="flex-1 text-sm font-semibold text-[var(--text-primary)] truncate">{source.title}</h2>
          {!source.is_processed && (
            <button
              onClick={onProcess}
              disabled={processing}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-50"
            >
              <Cpu size={12} />
              {processing ? "Processing..." : "Process"}
            </button>
          )}
          {source.is_processed && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <Cpu size={11} /> {source.chunk_count ?? 0} chunks
            </span>
          )}
          {source.url && (
            <Tooltip content="Open URL">
              <button
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                onClick={() => openShell(source.url!)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <ExternalLink size={13} />
              </button>
            </Tooltip>
          )}
          <Tooltip content="Delete source">
            <button onClick={onDelete} className="p-1 text-[var(--text-muted)] hover:text-red-400">
              <Trash2 size={13} />
            </button>
          </Tooltip>
          <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 p-4 overflow-y-auto min-h-0">
          <div className="flex flex-wrap gap-3 mb-4 text-[10px] text-[var(--text-muted)]">
            <span className={`px-1.5 py-0.5 rounded ${source.source_type === "document" ? "bg-blue-500/10 text-blue-400" : "bg-green-500/10 text-green-400"}`}>
              {source.source_type === "document" ? "Document" : "Web Capture"}
            </span>
            {source.token_count != null && <span>{formatTokens(source.token_count)}</span>}
            {source.file_type && <span>Type: {source.file_type}</span>}
            {source.file_size != null && <span>{formatBytes(source.file_size)}</span>}
            {source.url && <span className="truncate max-w-xs">{source.url}</span>}
          </div>
          {source.summary && (
            <div className="mb-4 p-3 rounded-lg bg-[var(--bg-hover)] border border-[var(--border-color)]">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Summary</p>
              <p className="text-sm text-[var(--text-secondary)]">{source.summary}</p>
            </div>
          )}
          <pre className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap font-mono leading-relaxed">
            {source.content?.slice(0, 5000)}
            {(source.content?.length ?? 0) > 5000 && "\n...[truncated]"}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ── Main view ───────────────────────────────────────────────────────────

export default function NoteEditorView() {
  const { activeWorkspaceId } = useScopedWorkspace();
  const includeDescendants = useBubbleUpFlag();
  const isDemoMode = useWorkspaceStore((state) => state.isDemoMode);
  const preferredModel = useSettingsStore((s) => s.preferredModel);
  const ollamaUrl = useSettingsStore((s) => s.ollamaUrl);

  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [query, setQuery] = useState("");

  // Open-item state (modal targets)
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [openSourceId, setOpenSourceId] = useState<string | null>(null);

  // Modal-edit buffers
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editIsPinned, setEditIsPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatingFlashcards, setGeneratingFlashcards] = useState(false);

  // Source actions
  const [showAddCapture, setShowAddCapture] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [savingCapture, setSavingCapture] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  // Listen for menu "New Note" — focus composer is enough; here we just create blank.
  useEffect(() => {
    function onNewNote() { void createBlankNote(); }
    window.addEventListener("aetherium:new-note", onNewNote);
    return () => window.removeEventListener("aetherium:new-note", onNewNote);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);

  // Load notes + sources
  useEffect(() => {
    if (!activeWorkspaceId) { return; }
    let cancelled = false;
    Promise.all([
      api.note.list(activeWorkspaceId, { limit: 500, offset: 0, includeDescendants }),
      api.source.list(activeWorkspaceId, undefined, { includeDescendants }),
    ]).then(([noteList, sourceList]) => {
      if (cancelled) { return; }
      setNotes(noteList);
      setSources(sourceList);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [activeWorkspaceId, includeDescendants]);

  const openNote = useMemo(
    () => openNoteId ? notes.find((n) => n.id === openNoteId) ?? null : null,
    [openNoteId, notes]
  );
  const openSource = useMemo(
    () => openSourceId ? sources.find((s) => s.id === openSourceId) ?? null : null,
    [openSourceId, sources]
  );

  // Seed modal buffers when a note opens
  useEffect(() => {
    if (!openNoteId) { return; }
    const n = notes.find((x) => x.id === openNoteId);
    if (!n) { return; }
    setEditTitle(n.title);
    setEditContent(n.content);
    setEditTags(n.tags ?? []);
    setEditIsPinned(n.is_pinned);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNoteId]);

  // Debounced autosave for the open note
  useEffect(() => {
    if (!openNoteId) { return; }
    const t = setTimeout(() => {
      setSaving(true);
      api.note.update(openNoteId, { title: editTitle, content: editContent, tags: editTags, is_pinned: editIsPinned })
        .then(() => {
          setNotes((prev) => prev.map((n) =>
            n.id === openNoteId
              ? { ...n, title: editTitle, content: editContent, tags: editTags, is_pinned: editIsPinned, updated_at: new Date().toISOString() }
              : n
          ));
        })
        .finally(() => setSaving(false));
    }, 1200);
    return () => clearTimeout(t);
  }, [openNoteId, editTitle, editContent, editTags, editIsPinned]);

  // Items + search
  const allItems = useMemo<WorkspaceItem[]>(
    () => [...notes.map(itemFromNote), ...sources.map(itemFromSource)]
      .sort((a, b) => {
        const aPinned = a.kind === "note" ? a.note.is_pinned : false;
        const bPinned = b.kind === "note" ? b.note.is_pinned : false;
        if (aPinned !== bPinned) { return aPinned ? -1 : 1; }
        return a.updatedAt < b.updatedAt ? 1 : -1;
      }),
    [notes, sources]
  );

  const filtered = useMemo(() => {
    if (!query.trim()) { return allItems; }
    const q = query.toLowerCase();
    return allItems.filter((item) => {
      if (item.title.toLowerCase().includes(q)) { return true; }
      if (item.kind === "note") {
        if (item.note.content.toLowerCase().includes(q)) { return true; }
        if (item.note.tags?.some((t) => t.toLowerCase().includes(q))) { return true; }
      } else {
        if ((item.source.filename ?? "").toLowerCase().includes(q)) { return true; }
        if ((item.source.url ?? "").toLowerCase().includes(q)) { return true; }
        if ((item.source.summary ?? "").toLowerCase().includes(q)) { return true; }
      }
      return false;
    });
  }, [allItems, query]);

  // ── Note actions ────────────────────────────────────────────────────

  async function createNoteFromComposer({ title, content, tags, isPinned }: { title: string; content: string; tags: string[]; isPinned: boolean }) {
    if (!activeWorkspaceId) { return; }
    const note = await api.note.create(activeWorkspaceId, title || "Untitled", content || undefined, null, isPinned);
    const seeded: ProjectNote = { ...note, title: title || "Untitled", content, tags, is_pinned: isPinned };
    if (tags.length > 0 || note.is_pinned !== isPinned) {
      await api.note.update(note.id, { tags, is_pinned: isPinned });
    }
    setNotes((prev) => [seeded, ...prev]);
  }

  async function createBlankNote() {
    if (!activeWorkspaceId) { return; }
    const note = await api.note.create(activeWorkspaceId, "Untitled Note");
    setNotes((prev) => [note, ...prev]);
    setOpenNoteId(note.id);
  }

  async function deleteNote(id: string) {
    if (isDemoMode) {
      await message("Note deletion is not available in Demo Mode.", { title: "Demo Mode" });
      return;
    }
    if (!await confirm("Delete this note?", { title: "Delete note?", kind: "warning" })) { return; }
    await api.note.delete(id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (openNoteId === id) { setOpenNoteId(null); }
  }

  async function generateFlashcardsFromOpenNote() {
    if (!activeWorkspaceId || !preferredModel || !openNote || editContent.length < 50) { return; }
    setGeneratingFlashcards(true);
    try {
      const cards = await api.flashcard.extractFromContent(
        activeWorkspaceId, editContent, "note", preferredModel, openNote.id, ollamaUrl || undefined
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

  // ── Source actions ──────────────────────────────────────────────────

  async function handleUpload() {
    if (!activeWorkspaceId) { return; }
    try {
      const paths = await openDialog({
        multiple: true,
        filters: [{ name: "Documents", extensions: ["txt", "md", "json", "csv"] }],
      }) as string[] | null;
      if (!paths || paths.length === 0) { return; }
      for (const path of paths) {
        const fileContent = await readTextFile(path);
        const filename = path.split("/").pop() ?? path;
        const ext = filename.split(".").pop() ?? "txt";
        const src = await api.source.create({
          workspace_id: activeWorkspaceId,
          source_type: "document",
          title: filename,
          filename,
          file_type: ext,
          file_size: fileContent.length,
          content: fileContent,
        });
        setSources((prev) => [src, ...prev]);
      }
    } catch (err) {
      console.error("Upload failed:", err);
    }
  }

  async function addWebCapture() {
    if (!activeWorkspaceId || !newUrl.trim()) { return; }
    setSavingCapture(true);
    try {
      const src = await api.source.create({
        workspace_id: activeWorkspaceId,
        source_type: "web_capture",
        title: newTitle.trim() || newUrl.trim(),
        url: newUrl.trim(),
        content: "",
      });
      setSources((prev) => [src, ...prev]);
      setNewUrl(""); setNewTitle("");
      setShowAddCapture(false);
    } catch (err) {
      console.error("Capture failed:", err);
    } finally {
      setSavingCapture(false);
    }
  }

  async function processSource(id: string) {
    setProcessing(id);
    try {
      const chunkCount = await api.source.process(id);
      setSources((prev) => prev.map((s) =>
        s.id === id ? { ...s, is_processed: true, chunk_count: chunkCount } : s
      ));
    } finally {
      setProcessing(null);
    }
  }

  async function deleteSource(id: string) {
    if (!await confirm("Delete this source?", { title: "Delete source?", kind: "warning" })) { return; }
    await api.source.delete(id);
    setSources((prev) => prev.filter((s) => s.id !== id));
    if (openSourceId === id) { setOpenSourceId(null); }
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--bg-primary)]">
      {/* Header — search + quick actions */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-color)] shrink-0">
        <div className="flex-1 max-w-md relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search library…"
            className="w-full pl-8 pr-2 py-1.5 text-xs rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
          />
        </div>
        <Tooltip content="New note">
          <button
            onClick={() => createBlankNote()}
            disabled={!activeWorkspaceId}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
          >
            <Plus size={14} />
          </button>
        </Tooltip>
      </div>

      {/* Scroll body */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <Composer
          onCreate={createNoteFromComposer}
          onUpload={handleUpload}
          onWebCapture={() => setShowAddCapture(true)}
          disabled={!activeWorkspaceId}
        />

        {/* Masonry grid via CSS columns */}
        <div className="px-4 pb-8 max-w-7xl mx-auto">
          {!activeWorkspaceId ? (
            <p className="text-center text-xs text-[var(--text-muted)] py-12">Select a workspace.</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-xs text-[var(--text-muted)] py-12">
              {allItems.length === 0 ? "No library items yet — add one above." : "No matches."}
            </p>
          ) : (
            <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-4">
              {filtered.map((item) => (
                <NoteCard
                  key={`${item.kind}:${item.id}`}
                  item={item}
                  onClick={() => {
                    if (item.kind === "note") { setOpenNoteId(item.id); }
                    else { setOpenSourceId(item.id); }
                  }}
                  onDelete={() => {
                    if (item.kind === "note") { void deleteNote(item.id); }
                    else { void deleteSource(item.id); }
                  }}
                  onProcessSource={item.kind === "source" ? () => processSource(item.id) : undefined}
                  processing={processing === item.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Note edit modal */}
      {openNote && (
        <NoteModal
          note={openNote}
          saving={saving}
          onChange={({ title, content, tags, is_pinned }) => {
            setEditTitle(title); setEditContent(content); setEditTags(tags);
            setEditIsPinned(is_pinned);
            setNotes((prev) => prev.map((n) => (n.id === openNote.id ? { ...n, is_pinned } : n)));
          }}
          onClose={() => setOpenNoteId(null)}
          onDelete={() => deleteNote(openNote.id)}
          onGenerateFlashcards={generateFlashcardsFromOpenNote}
          generatingFlashcards={generatingFlashcards}
          canGenerateFlashcards={!!preferredModel}
        />
      )}

      {/* Source detail modal */}
      {openSource && (
        <SourceModal
          source={openSource}
          onClose={() => setOpenSourceId(null)}
          onDelete={() => deleteSource(openSource.id)}
          onProcess={() => processSource(openSource.id)}
          processing={processing === openSource.id}
        />
      )}

      {/* Add web capture modal */}
      {showAddCapture && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => { setShowAddCapture(false); setNewUrl(""); setNewTitle(""); }}
        >
          <div
            className="w-96 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-2xl p-6 shadow-2xl flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Add Web Capture</h3>
            <input
              autoFocus
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setShowAddCapture(false); setNewUrl(""); setNewTitle(""); } }}
              placeholder="URL (required)"
              className="px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
            />
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Title (optional)"
              className="px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setShowAddCapture(false); setNewUrl(""); setNewTitle(""); }}
                className="flex-1 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
              <button
                onClick={addWebCapture}
                disabled={savingCapture || !newUrl.trim()}
                className="flex-1 py-2 rounded-lg bg-[var(--accent-color)] text-white text-sm hover:opacity-90 disabled:opacity-40"
              >
                {savingCapture ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
