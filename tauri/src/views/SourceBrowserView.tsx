/**
 * SourceBrowserView — unified browser for documents and web captures.
 * Displays sources in a collapsible folder tree with token counts.
 */
import React, { useEffect, useLayoutEffect, useState, useRef, useCallback } from "react";
import { Upload, Globe, Trash2, Cpu, X, Search, ExternalLink, FolderOpen, Folder, ChevronRight, MoreHorizontal, File, FolderPlus, Pencil } from "lucide-react";
import { api, type Source } from "../lib/api";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { useScopedWorkspace, useBubbleUpFlag } from "../lib/workspacePane";

// ── Folder tree helpers ─────────────────────────────────────────────────

interface FolderNode {
  name: string;
  path: string; // full path e.g. "Tech/Web"
  children: FolderNode[];
  sources: Source[];
}

/** Build a tree from flat sources based on their `folder` field (slash-delimited). */
function buildFolderTree(sources: Source[]): FolderNode {
  const root: FolderNode = { name: "", path: "", children: [], sources: [] };

  for (const src of sources) {
    const folder = src.folder?.trim() || "";
    if (!folder) {
      root.sources.push(src);
      continue;
    }
    const parts = folder.split("/").filter(Boolean);
    let node = root;
    let pathSoFar = "";
    for (const part of parts) {
      pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part;
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path: pathSoFar, children: [], sources: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.sources.push(src);
  }

  // Sort children alphabetically, sources by title
  function sortNode(n: FolderNode) {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.sources.sort((a, b) => a.title.localeCompare(b.title));
    n.children.forEach(sortNode);
  }
  sortNode(root);
  return root;
}

function formatTokens(n?: number): string {
  if (n == null || n === 0) { return ""; }
  if (n >= 1000) { return `${(n / 1000).toFixed(0)}K tokens`; }
  return `${n} tokens`;
}

// ── Context menu ────────────────────────────────────────────────────────

interface ContextMenuProps {
  x: number;
  y: number;
  source: Source;
  onClose: () => void;
  onDelete: (id: string) => void;
  onProcess: (id: string) => void;
  onRename: (source: Source) => void;
  onMoveToFolder: (source: Source) => void;
}

function ContextMenu({ x, y, source, onClose, onDelete, onProcess, onRename, onMoveToFolder }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { onClose(); }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  useLayoutEffect(() => {
    if (!ref.current) {return;}
    const el = ref.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let nx = x;
    let ny = y;
    if (rect.right > window.innerWidth - pad) { nx = window.innerWidth - rect.width - pad; }
    if (rect.bottom > window.innerHeight - pad) { ny = window.innerHeight - rect.height - pad; }
    if (nx < pad) { nx = pad; }
    if (ny < pad) { ny = pad; }
    if (nx !== x || ny !== y) {
      el.style.left = `${nx}px`;
      el.style.top = `${ny}px`;
    }
  }, [x, y]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[160px] py-1 bg-[var(--bg-elevated)] backdrop-blur-xl border border-[var(--border-color)] rounded-lg shadow-xl"
      style={{ left: x, top: y }}
    >
      <button
        onClick={() => { onRename(source); onClose(); }}
        className="w-full px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] flex items-center gap-2"
      >
        <Pencil size={11} /> Rename
      </button>
      <button
        onClick={() => { onMoveToFolder(source); onClose(); }}
        className="w-full px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] flex items-center gap-2"
      >
        <FolderPlus size={11} /> Move to folder...
      </button>
      {!source.is_processed && (
        <button
          onClick={() => { onProcess(source.id); onClose(); }}
          className="w-full px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] flex items-center gap-2"
        >
          <Cpu size={11} /> Process
        </button>
      )}
      {source.url && (
        <button
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          onClick={() => { openShell(source.url!); onClose(); }}
          className="w-full px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] flex items-center gap-2"
        >
          <ExternalLink size={11} /> Open URL
        </button>
      )}
      <div className="my-1 border-t border-[var(--border-color)]" />
      <button
        onClick={() => { onDelete(source.id); onClose(); }}
        className="w-full px-3 py-1.5 text-left text-xs text-red-400 hover:bg-[var(--bg-hover)] flex items-center gap-2"
      >
        <Trash2 size={11} /> Delete
      </button>
    </div>
  );
}

// ── Folder tree item ────────────────────────────────────────────────────

function FolderTreeNode({
  node,
  depth,
  expanded,
  toggleExpanded,
  selectedId,
  onSelect,
  onContextMenu,
}: {
  node: FolderNode;
  depth: number;
  expanded: Set<string>;
  toggleExpanded: (path: string) => void;
  selectedId: string | null;
  onSelect: (source: Source) => void;
  onContextMenu: (e: React.MouseEvent, source: Source) => void;
}) {
  const isOpen = expanded.has(node.path);

  return (
    <>
      {/* Folder header */}
      {node.name && (
        <button
          onClick={() => toggleExpanded(node.path)}
          className="w-full flex items-center gap-1.5 py-1.5 hover:bg-[var(--bg-hover)] transition-colors text-[var(--text-secondary)]"
          style={{ paddingLeft: depth * 16 + 8 }}
        >
          <ChevronRight
            size={11}
            className={`flex-shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
          />
          {isOpen ? (
            <FolderOpen size={13} className="flex-shrink-0 text-[var(--text-muted)]" />
          ) : (
            <Folder size={13} className="flex-shrink-0 text-[var(--text-muted)]" />
          )}
          <span className="text-xs font-medium truncate">{node.name}</span>
        </button>
      )}

      {/* Folder contents (show if root or expanded) */}
      {(!node.name || isOpen) && (
        <>
          {/* Sub-folders */}
          {node.children.map((child) => (
            <FolderTreeNode
              key={child.path}
              node={child}
              depth={node.name ? depth + 1 : depth}
              expanded={expanded}
              toggleExpanded={toggleExpanded}
              selectedId={selectedId}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
          ))}

          {/* Sources in this folder */}
          {node.sources.map((src) => (
            <div
              key={src.id}
              onClick={() => onSelect(src)}
              onContextMenu={(e) => onContextMenu(e, src)}
              className={`group flex items-center gap-2 cursor-pointer transition-colors ${
                selectedId === src.id
                  ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                  : "hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
              }`}
              style={{ paddingLeft: (node.name ? depth + 1 : depth) * 16 + 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5 }}
            >
              <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                <span className="text-xs truncate">{src.title}</span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {src.token_count != null && src.token_count > 0 && (
                    <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap">
                      {formatTokens(src.token_count)}
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); onContextMenu(e, src); }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-[var(--text-primary)] transition-all"
                  >
                    <MoreHorizontal size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

// ── Main view ───────────────────────────────────────────────────────────

export default function SourceBrowserView() {
  const { activeWorkspaceId } = useScopedWorkspace();
  const includeDescendants = useBubbleUpFlag();
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState<Source | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Folder tree state
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Upload state
  const [uploading, setUploading] = useState(false);

  // Web capture add state
  const [showAddCapture, setShowAddCapture] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [saving, setSaving] = useState(false);

  // Processing state
  const [processing, setProcessing] = useState<string | null>(null);

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; source: Source } | null>(null);

  // Rename modal
  const [renaming, setRenaming] = useState<Source | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Move-to-folder modal
  const [moving, setMoving] = useState<Source | null>(null);
  const [moveFolderValue, setMoveFolderValue] = useState("");

  // Upload folder target
  const [uploadFolder, setUploadFolder] = useState("");
  const [showUploadDialog, setShowUploadDialog] = useState(false);

  useEffect(() => {
    if (!activeWorkspaceId) { return; }
    api.source.list(activeWorkspaceId, undefined, { includeDescendants }).then((items) => {
      setSources(items);
      // Auto-expand all folders
      const folders = new Set<string>();
      for (const s of items) {
        if (!s.folder) { continue; }
        const parts = s.folder.split("/").filter(Boolean);
        let path = "";
        for (const p of parts) {
          path = path ? `${path}/${p}` : p;
          folders.add(path);
        }
      }
      setExpanded(folders);
    }).catch(() => {});
  }, [activeWorkspaceId, includeDescendants]);

  const toggleExpanded = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) { next.delete(path); }
      else { next.add(path); }
      return next;
    });
  }, []);

  // Filter sources by search
  const filtered = sources.filter((s) => {
    if (!searchQuery) { return true; }
    const q = searchQuery.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      (s.filename ?? "").toLowerCase().includes(q) ||
      (s.url ?? "").toLowerCase().includes(q) ||
      (s.folder ?? "").toLowerCase().includes(q)
    );
  });

  const tree = buildFolderTree(filtered);

  // Get all unique folder paths for autocomplete
  const allFolders = Array.from(
    new Set(sources.map((s) => s.folder).filter(Boolean) as string[])
  ).sort();

  async function handleUpload(folder?: string) {
    if (!activeWorkspaceId) { return; }
    setUploading(true);
    try {
      const paths = await openDialog({
        multiple: true,
        filters: [{ name: "Documents", extensions: ["txt", "md", "json", "csv"] }],
      }) as string[] | null;
      if (!paths || paths.length === 0) { return; }

      for (const path of paths) {
        const content = await readTextFile(path);
        const filename = path.split("/").pop() ?? path;
        const ext = filename.split(".").pop() ?? "txt";
        const src = await api.source.create({
          workspace_id: activeWorkspaceId,
          source_type: "document",
          title: filename,
          filename,
          file_type: ext,
          file_size: content.length,
          content,
          folder: folder || undefined,
        });
        setSources((prev) => [src, ...prev]);
        if (folder) {
          const parts = folder.split("/").filter(Boolean);
          let path2 = "";
          for (const p of parts) {
            path2 = path2 ? `${path2}/${p}` : p;
            setExpanded((prev) => new Set(prev).add(path2));
          }
        }
      }
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  }

  async function addWebCapture() {
    if (!activeWorkspaceId || !newUrl.trim()) { return; }
    setSaving(true);
    try {
      const src = await api.source.create({
        workspace_id: activeWorkspaceId,
        source_type: "web_capture",
        title: newTitle.trim() || newUrl.trim(),
        url: newUrl.trim(),
        content: "",
        folder: newFolder.trim() || undefined,
      });
      setSources((prev) => [src, ...prev]);
      setNewUrl("");
      setNewTitle("");
      setNewFolder("");
      setShowAddCapture(false);
    } catch (err) {
      console.error("Capture failed:", err);
    } finally {
      setSaving(false);
    }
  }

  async function processSource(id: string) {
    setProcessing(id);
    try {
      const chunkCount = await api.source.process(id);
      setSources((prev) =>
        prev.map((s) => s.id === id ? { ...s, is_processed: true, chunk_count: chunkCount } : s)
      );
      if (selected?.id === id) { setSelected((s) => s ? { ...s, is_processed: true, chunk_count: chunkCount } : s); }
    } finally {
      setProcessing(null);
    }
  }

  async function deleteSource(id: string) {
    await api.source.delete(id);
    setSources((prev) => prev.filter((s) => s.id !== id));
    if (selected?.id === id) { setSelected(null); }
  }

  async function renameSource() {
    if (!renaming || !renameValue.trim()) { return; }
    try {
      await api.source.update(renaming.id, { title: renameValue.trim() });
      setSources((prev) => prev.map((s) => s.id === renaming.id ? { ...s, title: renameValue.trim() } : s));
      if (selected?.id === renaming.id) { setSelected((s) => s ? { ...s, title: renameValue.trim() } : s); }
    } finally {
      setRenaming(null);
    }
  }

  async function moveSource() {
    if (!moving) { return; }
    const folder = moveFolderValue.trim() || undefined;
    try {
      await api.source.update(moving.id, { folder: folder ?? "" });
      setSources((prev) => prev.map((s) => s.id === moving.id ? { ...s, folder } : s));
      if (selected?.id === moving.id) { setSelected((s) => s ? { ...s, folder } : s); }
      if (folder) {
        const parts = folder.split("/").filter(Boolean);
        let path = "";
        for (const p of parts) {
          path = path ? `${path}/${p}` : p;
          setExpanded((prev) => new Set(prev).add(path));
        }
      }
    } finally {
      setMoving(null);
    }
  }

  function handleContextMenu(e: React.MouseEvent, source: Source) {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, source });
  }

  function formatBytes(n: number) {
    if (n < 1024) { return `${n} B`; }
    if (n < 1024 * 1024) { return `${(n / 1024).toFixed(1)} KB`; }
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <div className="w-72 border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] flex flex-col">
        {/* Header with actions */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-color)]">
          <span className="text-xs font-medium text-[var(--text-secondary)]">Sources</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowUploadDialog(true)}
              disabled={uploading || !activeWorkspaceId}
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-40"
              title="Upload document"
            >
              <Upload size={10} /> File
            </button>
            <button
              onClick={() => setShowAddCapture(true)}
              disabled={!activeWorkspaceId}
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              title="Add web capture"
            >
              <Globe size={10} /> URL
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-2 py-1.5 border-b border-[var(--border-color)]">
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sources..."
              className="w-full pl-7 pr-2 py-1 text-[11px] rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
            />
          </div>
        </div>

        {/* Folder tree */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-xs text-center text-[var(--text-muted)]">
              {sources.length === 0 ? "No sources yet" : "No matches"}
            </p>
          ) : (
            <FolderTreeNode
              node={tree}
              depth={0}
              expanded={expanded}
              toggleExpanded={toggleExpanded}
              selectedId={selected?.id ?? null}
              onSelect={setSelected}
              onContextMenu={handleContextMenu}
            />
          )}
        </div>
      </div>

      {/* Detail pane */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {selected ? (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2 min-w-0">
                {selected.source_type === "document" ? <File size={14} /> : <Globe size={14} />}
                <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">{selected.title}</h2>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {!selected.is_processed && (
                  <button
                    onClick={() => processSource(selected.id)}
                    disabled={processing === selected.id}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-50"
                  >
                    <Cpu size={12} />
                    {processing === selected.id ? "Processing..." : "Process"}
                  </button>
                )}
                {selected.is_processed && (
                  <span className="text-xs text-green-400 flex items-center gap-1">
                    <Cpu size={11} /> {selected.chunk_count ?? 0} chunks
                  </span>
                )}
                {selected.url && (
                  <button
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    onClick={() => openShell(selected.url!)}
                    className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
                    title="Open URL"
                  >
                    <ExternalLink size={13} />
                  </button>
                )}
                <button onClick={() => setSelected(null)}>
                  <X size={14} className="text-[var(--text-muted)]" />
                </button>
              </div>
            </div>
            <div className="flex-1 p-4 overflow-y-auto min-h-0">
              {/* Metadata */}
              <div className="flex flex-wrap gap-3 mb-4 text-[10px] text-[var(--text-muted)]">
                <span className={`px-1.5 py-0.5 rounded ${selected.source_type === "document" ? "bg-blue-500/10 text-blue-400" : "bg-green-500/10 text-green-400"}`}>
                  {selected.source_type === "document" ? "Document" : "Web Capture"}
                </span>
                {selected.folder && <span>Folder: {selected.folder}</span>}
                {selected.token_count != null && <span>{formatTokens(selected.token_count)}</span>}
                {selected.file_type && <span>Type: {selected.file_type}</span>}
                {selected.file_size != null && <span>{formatBytes(selected.file_size)}</span>}
                {selected.url && <span className="truncate max-w-xs">{selected.url}</span>}
              </div>
              {selected.summary && (
                <div className="mb-4 p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)]">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Summary</p>
                  <p className="text-sm text-[var(--text-secondary)]">{selected.summary}</p>
                </div>
              )}
              <pre className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap font-mono leading-relaxed">
                {selected.content?.slice(0, 5000)}
                {(selected.content?.length ?? 0) > 5000 && "\n...[truncated]"}
              </pre>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-[var(--text-muted)] text-sm">Select a source to view</p>
          </div>
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          source={ctxMenu.source}
          onClose={() => setCtxMenu(null)}
          onDelete={deleteSource}
          onProcess={processSource}
          onRename={(s) => { setRenaming(s); setRenameValue(s.title); }}
          onMoveToFolder={(s) => { setMoving(s); setMoveFolderValue(s.folder ?? ""); }}
        />
      )}

      {/* Upload dialog (choose folder) */}
      {showUploadDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => { setShowUploadDialog(false); setUploadFolder(""); }}
        >
          <div
            className="w-96 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-2xl p-6 shadow-2xl flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Upload Document</h3>
            <div>
              <label className="text-xs text-[var(--text-muted)] mb-1 block">Folder (optional, use / for nesting)</label>
              <input
                autoFocus
                value={uploadFolder}
                onChange={(e) => setUploadFolder(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { setShowUploadDialog(false); setUploadFolder(""); } }}
                placeholder="e.g. Tech/Web"
                list="folder-suggestions-upload"
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
              />
              <datalist id="folder-suggestions-upload">
                {allFolders.map((f) => <option key={f} value={f} />)}
              </datalist>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowUploadDialog(false); setUploadFolder(""); }}
                className="flex-1 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowUploadDialog(false); handleUpload(uploadFolder.trim() || undefined); setUploadFolder(""); }}
                disabled={uploading}
                className="flex-1 py-2 rounded-lg bg-[var(--accent-color)] text-white text-sm hover:opacity-90 disabled:opacity-40"
              >
                Choose File...
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Web Capture modal */}
      {showAddCapture && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => { setShowAddCapture(false); setNewUrl(""); setNewTitle(""); setNewFolder(""); }}
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
              onKeyDown={(e) => { if (e.key === "Escape") { setShowAddCapture(false); setNewUrl(""); setNewTitle(""); setNewFolder(""); } }}
              placeholder="URL (required)"
              className="px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
            />
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Title (optional)"
              className="px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
            />
            <div>
              <input
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                placeholder="Folder (optional, e.g. Tech/Web)"
                list="folder-suggestions-capture"
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
              />
              <datalist id="folder-suggestions-capture">
                {allFolders.map((f) => <option key={f} value={f} />)}
              </datalist>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowAddCapture(false); setNewUrl(""); setNewTitle(""); setNewFolder(""); }}
                className="flex-1 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
              <button
                onClick={addWebCapture}
                disabled={saving || !newUrl.trim()}
                className="flex-1 py-2 rounded-lg bg-[var(--accent-color)] text-white text-sm hover:opacity-90 disabled:opacity-40"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename modal */}
      {renaming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setRenaming(null)}
        >
          <div
            className="w-80 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-2xl p-6 shadow-2xl flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Rename Source</h3>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { renameSource(); } else if (e.key === "Escape") { setRenaming(null); } }}
              className="px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setRenaming(null)}
                className="flex-1 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
              <button
                onClick={renameSource}
                disabled={!renameValue.trim()}
                className="flex-1 py-2 rounded-lg bg-[var(--accent-color)] text-white text-sm hover:opacity-90 disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move to folder modal */}
      {moving && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setMoving(null)}
        >
          <div
            className="w-80 bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-2xl p-6 shadow-2xl flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Move to Folder</h3>
            <p className="text-xs text-[var(--text-muted)]">Use / to nest folders (e.g. Tech/Web). Leave empty for root.</p>
            <input
              autoFocus
              value={moveFolderValue}
              onChange={(e) => setMoveFolderValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { moveSource(); } else if (e.key === "Escape") { setMoving(null); } }}
              placeholder="Folder path"
              list="folder-suggestions-move"
              className="px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
            />
            <datalist id="folder-suggestions-move">
              {allFolders.map((f) => <option key={f} value={f} />)}
            </datalist>
            <div className="flex gap-2">
              <button
                onClick={() => setMoving(null)}
                className="flex-1 py-2 rounded-lg border border-[var(--border-color)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
              <button
                onClick={moveSource}
                className="flex-1 py-2 rounded-lg bg-[var(--accent-color)] text-white text-sm hover:opacity-90 disabled:opacity-40"
              >
                Move
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
