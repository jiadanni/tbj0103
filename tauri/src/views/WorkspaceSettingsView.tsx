/**
 * WorkspaceSettingsView — manage workspaces: rename, reorder, delete, and switch.
 * Mirrors WorkspaceListView.swift + workspace picker behaviour.
 */
import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, Check, X, LayoutGrid, Sparkles, Loader2 } from "lucide-react";
import { api, type AiModel } from "../lib/api";
import { resolveModelForRole } from "../lib/modelRoles";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { Workspace } from "../stores/workspaceStore";

export default function WorkspaceSettingsView() {
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId, addWorkspace, setWorkspaces } = useWorkspaceStore();
  const { preferredModel, backgroundModel, ollamaUrl } = useSettingsStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [aiModels, setAiModels] = useState<AiModel[]>([]);

  useEffect(() => {
    api.aiModel.list().then(setAiModels).catch(() => {});
  }, []);

  async function createWorkspace() {
    if (!newName.trim()) {return;}
    setCreating(true);
    try {
      const ws = await api.workspace.create(newName.trim());
      addWorkspace(ws);
      setActiveWorkspaceId(ws.id);
      setNewName("");
      setShowNew(false);
    } finally {
      setCreating(false);
    }
  }

  async function renameWorkspace(id: string) {
    if (!editName.trim()) { setEditingId(null); return; }
    await api.workspace.update(id, editName.trim());
    setWorkspaces(workspaces.map((w) => w.id === id ? { ...w, name: editName.trim() } : w));
    setEditingId(null);
  }

  async function deleteWorkspace(ws: Workspace) {
    if (workspaces.length === 1) {
      window.alert("Cannot delete the last workspace.");
      return;
    }
    if (!window.confirm(`Delete "${ws.name}" and all its projects, notes, and data? This cannot be undone.`)) {return;}
    await api.workspace.delete(ws.id);
    const remaining = workspaces.filter((w) => w.id !== ws.id);
    setWorkspaces(remaining);
    if (activeWorkspaceId === ws.id) {
      setActiveWorkspaceId(remaining[0]?.id ?? null);
    }
  }

  async function analyzeWorkspace(id: string) {
    if (analyzingId) {return;}
    setAnalyzingId(id);
    try {
      const analysisModel = resolveModelForRole(aiModels, "background", backgroundModel, preferredModel);
      const newSignature = await api.topicSignature.regenerate(id, analysisModel || undefined, ollamaUrl || undefined);
      setWorkspaces(workspaces.map(w => w.id === id ? { ...w, topic_signature: newSignature } : w));
    } catch (err) {
      console.error("Failed to analyze workspace:", err);
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzingId(null);
    }
  }

  async function updateSignature(id: string, manual: string[], ignored: string[]) {
    try {
      const newSig = await api.topicSignature.update(id, manual, ignored);
      setWorkspaces(workspaces.map(w => w.id === id ? { ...w, topic_signature: newSig } : w));
    } catch (err) {
      console.error("Failed to update signature:", err);
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)] shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-[var(--text-primary)]">Workspaces</h1>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{workspaces.length} workspace{workspaces.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90"
        >
          <Plus size={12} /> New Workspace
        </button>
      </div>

      {/* New workspace form */}
      {showNew && (
        <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--border-color)] bg-[var(--bg-elevated)] shrink-0">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {createWorkspace();}
              if (e.key === "Escape") { setShowNew(false); setNewName(""); }
            }}
            placeholder="Workspace name…"
            className="flex-1 text-sm bg-[var(--bg-input)] border border-[var(--border-color)] rounded-lg px-3 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
          />
          <button
            onClick={createWorkspace}
            disabled={creating || !newName.trim()}
            className="px-3 py-1.5 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-40"
          >
            {creating ? "Creating…" : "Create"}
          </button>
          <button
            onClick={() => { setShowNew(false); setNewName(""); }}
            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Workspace list */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {workspaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] gap-2">
            <LayoutGrid size={32} className="opacity-30" />
            <p className="text-sm">No workspaces yet.</p>
          </div>
        ) : (
          workspaces.map((ws) => {
            const isActive = ws.id === activeWorkspaceId;
            const isEditing = editingId === ws.id;
            const isAnalyzing = analyzingId === ws.id;
            const hasSignature = ws.topic_signature?.domain_tags?.length > 0 || 
                                 ws.topic_signature?.intent_patterns?.length > 0 ||
                                 ws.topic_signature?.manual_tags?.length > 0;

            return (
              <div
                key={ws.id}
                className={`rounded-xl border p-4 transition-colors ${
                  isActive
                    ? "border-[var(--accent-color)] bg-[var(--accent-color)]/5"
                    : "border-[var(--border-color)] bg-[var(--bg-elevated)] hover:border-[var(--border-color)]"
                }`}
              >
                <div className="flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    {/* Active indicator */}
                    <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${isActive ? "bg-[var(--accent-color)]" : "bg-[var(--bg-hover)]"}`} />

                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {renameWorkspace(ws.id);}
                              if (e.key === "Escape") {setEditingId(null);}
                            }}
                            className="flex-1 text-sm font-medium bg-[var(--bg-input)] border border-[var(--accent-color)] rounded px-2 py-0.5 text-[var(--text-primary)] outline-none"
                          />
                          <button onClick={() => renameWorkspace(ws.id)} className="text-[var(--accent-color)]">
                            <Check size={14} />
                          </button>
                          <button onClick={() => setEditingId(null)} className="text-[var(--text-muted)]">
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-base font-medium text-[var(--text-primary)] truncate">{ws.name}</span>
                          {isActive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent-color)]/20 text-[var(--accent-color)] font-medium">
                              Active
                            </span>
                          )}
                        </div>
                      )}
                      <p className="text-[11px] text-[var(--text-muted)] mt-1">
                        Created {formatDate(ws.created_at)}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {!isActive && (
                        <button
                          onClick={() => setActiveWorkspaceId(ws.id)}
                          className="px-2 py-1 text-[11px] rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--accent-color)] transition-colors"
                        >
                          Switch
                        </button>
                      )}
                      <button
                        onClick={() => { setEditingId(ws.id); setEditName(ws.name); }}
                        className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-hover)]"
                        title="Rename"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => deleteWorkspace(ws)}
                        className="p-1.5 text-[var(--text-muted)] hover:text-red-400 rounded-lg hover:bg-red-400/10"
                        title="Delete workspace"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Context and Topics (Topic Signature) */}
                  <div className="pl-5 pt-2 border-t border-[var(--border-color)]">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-semibold text-[var(--text-secondary)]">Workspace Context</h3>
                      <button
                        onClick={() => analyzeWorkspace(ws.id)}
                        disabled={isAnalyzing}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--accent-color)] hover:bg-[var(--accent-color)]/10 transition-colors disabled:opacity-50"
                        title="Analyze recent chats to discover topics and context"
                      >
                        {isAnalyzing ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                        {hasSignature ? "Refresh Context" : "Discover Context"}
                      </button>
                    </div>

                    <div className="space-y-4">
                      {/* AI Topics */}
                      {ws.topic_signature?.domain_tags?.length > 0 && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Inferred Topics</p>
                          <div className="flex flex-wrap gap-1.5">
                            {ws.topic_signature.domain_tags.map((tag, idx) => (
                              <div
                                key={idx}
                                className="group flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-[var(--bg-hover)] border border-[var(--border-color)] text-[var(--text-secondary)]"
                              >
                                <span>{tag.tag}</span>
                                <button
                                  onClick={() => {
                                    const ignored = [...(ws.topic_signature.ignored_tags || []), tag.tag];
                                    updateSignature(ws.id, ws.topic_signature.manual_tags || [], ignored);
                                  }}
                                  className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
                                  title="Ignore topic"
                                >
                                  <X size={10} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Manual Tags */}
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Manual Tags</p>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {(ws.topic_signature.manual_tags || []).map((tag, idx) => (
                            <div
                              key={idx}
                              className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-[var(--accent-color)]/10 border border-[var(--accent-color)]/20 text-[var(--accent-color)]"
                            >
                              <span>{tag}</span>
                              <button
                                onClick={() => {
                                  const manual = ws.topic_signature.manual_tags.filter(t => t !== tag);
                                  updateSignature(ws.id, manual, ws.topic_signature.ignored_tags || []);
                                }}
                                className="hover:text-red-400"
                              >
                                <X size={10} />
                              </button>
                            </div>
                          ))}
                          <input
                            type="text"
                            placeholder="+ Tag"
                            className="bg-transparent border-none outline-none text-[11px] text-[var(--text-primary)] w-16"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                const val = e.currentTarget.value.trim();
                                if (val) {
                                  const manual = [...(ws.topic_signature.manual_tags || []), val];
                                  updateSignature(ws.id, manual, ws.topic_signature.ignored_tags || []);
                                  e.currentTarget.value = "";
                                }
                              }
                            }}
                          />
                        </div>
                      </div>

                      {/* Blacklist (Ignored Tags) */}
                      {(ws.topic_signature.ignored_tags || []).length > 0 && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Ignored Topics</p>
                          <div className="flex flex-wrap gap-1.5">
                            {ws.topic_signature.ignored_tags.map((tag, idx) => (
                              <div
                                key={idx}
                                className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-[var(--bg-hover)] border border-dashed border-[var(--border-color)] text-[var(--text-muted)] line-through"
                              >
                                <span>{tag}</span>
                                <button
                                  onClick={() => {
                                    const ignored = ws.topic_signature.ignored_tags.filter(t => t !== tag);
                                    updateSignature(ws.id, ws.topic_signature.manual_tags || [], ignored);
                                  }}
                                  className="hover:text-[var(--text-primary)] line-none"
                                >
                                  <X size={10} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {ws.topic_signature?.intent_patterns?.length > 0 && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Expected Chats</p>
                          <ul className="list-disc list-inside space-y-1 ml-1 text-[11px] text-[var(--text-secondary)]">
                            {ws.topic_signature.intent_patterns.map((intent, idx) => (
                              <li key={idx}>{intent}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      <div className="text-[9px] text-[var(--text-muted)] pt-1 flex justify-between">
                        <span>Analyzed {ws.topic_signature.message_count_at_gen ?? 0} recent messages</span>
                        {ws.topic_signature.generated_at && (
                          <span>Last updated {formatDate(ws.topic_signature.generated_at)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Help text */}
      <div className="px-5 py-3 border-t border-[var(--border-color)] shrink-0">
        <p className="text-[11px] text-[var(--text-muted)]">
          Workspaces isolate projects, notes, daily entries, and knowledge graphs. Context and topics are automatically inferred from your chat history to improve search and routing.
        </p>
      </div>
    </div>
  );
}
