/**
 * DocumentBrowserView — upload, list and view project documents.
 * Mirrors DocumentBrowserView.swift.
 */
import { useEffect, useRef, useState } from "react";
import { Upload, File, Trash2, Cpu, ChevronRight, X } from "lucide-react";
import { api, type UploadedDocument } from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";

export default function DocumentBrowserView() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [selected, setSelected] = useState<UploadedDocument | null>(null);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    api.document.list(activeWorkspaceId).then(setDocuments).catch(() => {});
  }, [activeWorkspaceId]);

  async function handleUpload() {
    if (!activeWorkspaceId) return;
    setUploading(true);
    try {
      const paths = await open({
        multiple: true,
        filters: [{ name: "Documents", extensions: ["txt", "md", "json", "csv"] }],
      }) as string[] | null;
      if (!paths || paths.length === 0) return;

      for (const path of paths) {
        const content = await readTextFile(path);
        const filename = path.split("/").pop() ?? path;
        const ext = filename.split(".").pop() ?? "txt";
        const doc = await api.document.upload(
          activeWorkspaceId, filename, ext, content.length, content
        );
        setDocuments((prev) => [doc, ...prev]);
      }
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  }

  async function processDocument(id: string) {
    setProcessing(id);
    try {
      const chunkCount = await api.document.process(id);
      setDocuments((prev) =>
        prev.map((d) => d.id === id ? { ...d, is_processed: true, chunk_count: chunkCount } : d)
      );
    } finally {
      setProcessing(null);
    }
  }

  async function deleteDocument(id: string) {
    await api.document.delete(id);
    setDocuments((prev) => prev.filter((d) => d.id !== id));
    if (selected?.id === id) setSelected(null);
  }

  function formatBytes(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* List */}
      <div className="w-64 border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] flex flex-col">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-color)]">
          <span className="text-xs font-medium text-[var(--text-secondary)]">Documents</span>
          <button
            onClick={handleUpload}
            disabled={uploading || !activeWorkspaceId}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-40"
          >
            <Upload size={11} /> Upload
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {documents.length === 0 && (
            <p className="px-3 py-6 text-xs text-center text-[var(--text-muted)]">
              No documents yet
            </p>
          )}
          {documents.map((d) => (
            <div
              key={d.id}
              onClick={() => setSelected(d)}
              className={`group flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors ${
                selected?.id === d.id
                  ? "bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                  : "hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
              }`}
            >
              <File size={13} className="flex-shrink-0 opacity-60" />
              <div className="flex-1 min-w-0">
                <p className="text-xs truncate">{d.filename}</p>
                <p className="text-[10px] text-[var(--text-muted)]">
                  {formatBytes(d.file_size)} · {d.is_processed ? `${d.chunk_count} chunks` : "not processed"}
                </p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); deleteDocument(d.id); }}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 transition-all"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Detail */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)]">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">{selected.filename}</h2>
              <div className="flex items-center gap-2">
                {!selected.is_processed && (
                  <button
                    onClick={() => processDocument(selected.id)}
                    disabled={processing === selected.id}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-50"
                  >
                    <Cpu size={12} />
                    {processing === selected.id ? "Processing…" : "Process"}
                  </button>
                )}
                {selected.is_processed && (
                  <span className="text-xs text-green-400 flex items-center gap-1">
                    <Cpu size={11} /> {selected.chunk_count} chunks indexed
                  </span>
                )}
                <button onClick={() => setSelected(null)}>
                  <X size={14} className="text-[var(--text-muted)]" />
                </button>
              </div>
            </div>
            <div className="flex-1 p-4">
              {selected.summary && (
                <div className="mb-4 p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)]">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Summary</p>
                  <p className="text-sm text-[var(--text-secondary)]">{selected.summary}</p>
                </div>
              )}
              <pre className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap font-mono leading-relaxed">
                {selected.content?.slice(0, 5000)}
                {(selected.content?.length ?? 0) > 5000 && "\n…[truncated]"}
              </pre>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-[var(--text-muted)] text-sm">Select a document to view</p>
          </div>
        )}
      </div>
    </div>
  );
}
