import { useState } from "react";
import { Plus, Eye, EyeOff } from "lucide-react";
import { Toggle } from "../Toggle";
import { Tooltip } from "../Tooltip";
import { CompactMenuSelect } from "../CompactMenuSelect";
import { resolveModelDisplayName, resolveModelSecondaryDisplayName } from "../../lib/modelDisplayName";
import { api, type AiModel } from "../../lib/api";

interface WebAiPreferencesPanelProps {
  webSessionPreserve: boolean;
  onSetWebSessionPreserve: (value: boolean) => void;
  aiModels: AiModel[];
  webAiModels: AiModel[];
  modelLabels: Record<string, string>;
  onModelsChanged: () => void;
}

export function WebAiPreferencesPanel({
  webSessionPreserve,
  onSetWebSessionPreserve,
  aiModels,
  webAiModels,
  modelLabels,
  onModelsChanged,
}: WebAiPreferencesPanelProps) {
  const [showAddModel, setShowAddModel] = useState(false);
  const [newModelId, setNewModelId] = useState("");
  const [newModelName, setNewModelName] = useState("");
  const [newModelIsPaid, setNewModelIsPaid] = useState(false);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-4xl px-5 py-4 space-y-8">
          <section data-pref-section>
            <div className="pb-1.5 mb-3 border-b border-[var(--border-color)] flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Manual Browser Targets</h3>
                <p className="text-xs text-[var(--text-muted)]/80 mt-1">
                  Use manual browser automation for user-configured web targets. Select an enabled browser-backed model from the Chat view model dropdown to activate it. Requires Node.js and the <code className="px-1 py-0.5 rounded bg-[var(--bg-hover)] font-mono text-[10px]">playwright</code> npm package (<code className="px-1 py-0.5 rounded bg-[var(--bg-hover)] font-mono text-[10px]">npm install -g playwright && npx playwright install chromium</code>).
                </p>
              </div>
              <button
                onClick={() => { setShowAddModel(!showAddModel); setNewModelId(""); setNewModelName(""); setNewModelIsPaid(false); }}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 whitespace-nowrap"
              >
                <Plus size={11} /> Add Model
              </button>
            </div>

            {showAddModel && (
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 space-y-4 mb-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Provider Target</label>
                    <CompactMenuSelect
                      label="Select Provider"
                      value={newModelId}
                      options={[
                        { value: "", label: "Select provider..." },
                        { value: "chatgpt-web", label: "ChatGPT (Web)" },
                        { value: "deepseek-web", label: "DeepSeek (Web)" },
                        { value: "claude-web", label: "Claude (Web)" },
                        { value: "gemini-web", label: "Gemini (Web)" },
                      ]}
                      onChange={(val) => {
                        setNewModelId(val);
                        if (!newModelName) {
                          const label = val === "chatgpt-web" ? "ChatGPT" : val === "deepseek-web" ? "DeepSeek" : val === "claude-web" ? "Claude" : val === "gemini-web" ? "Gemini" : "";
                          setNewModelName(label);
                        }
                      }}
                      widthClassName="w-full"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Display Name</label>
                    <input
                      value={newModelName}
                      onChange={(e) => setNewModelName(e.target.value)}
                      placeholder="e.g. Browser Assistant A"
                      className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-[var(--border-color)]">
                  <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
                    <input type="checkbox" checked={newModelIsPaid} onChange={(e) => setNewModelIsPaid(e.target.checked)} className="accent-[var(--accent-color)]" />
                    Requires subscription (Paid)
                  </label>
                  <div className="flex gap-2">
                    <button onClick={() => setShowAddModel(false)} className="px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]">Cancel</button>
                    <button
                      disabled={!newModelId || !newModelName}
                      onClick={async () => {
                        const provider = `web_${newModelId.split("-")[0]}`;
                        await api.aiModel.add(newModelName, newModelId, {
                          provider,
                          is_paid: newModelIsPaid,
                          enabled: true,
                          priority: aiModels.length > 0 ? Math.max(...aiModels.map(m => m.priority)) + 1 : 1
                        });
                        onModelsChanged();
                        setShowAddModel(false); setNewModelId(""); setNewModelName(""); setNewModelIsPaid(false);
                      }}
                      className="px-4 py-1.5 text-xs font-medium rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90 disabled:opacity-40"
                    >
                      Add Target
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between py-2 border-b border-[var(--border-color)]">
              <div>
                <p className="text-sm text-[var(--text-secondary)]">Preserve browser session</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5 max-w-sm">
                  When <strong>off</strong> (default): login cookies are wiped from disk after every query — safest. When <strong>on</strong>: session is saved so you stay logged in between queries.
                </p>
                {webSessionPreserve && (
                  <p className="mt-1.5 text-[11px] px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 max-w-sm">
                    ⚠ Login cookies for web AI providers are stored on disk. Disable to wipe credentials after every query.
                  </p>
                )}
              </div>
              <Toggle
                on={webSessionPreserve}
                onToggle={() => onSetWebSessionPreserve(!webSessionPreserve)}
              />
            </div>

            {/* Web model list */}
            {webAiModels.length > 0 && (
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] overflow-hidden">
                <div className="grid grid-cols-[minmax(0,1fr)_60px_60px] items-center gap-3 px-4 py-2.5 bg-[var(--bg-hover)]/30 border-b border-[var(--border-color)] text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  <span>Model</span>
                  <span className="text-center">Active</span>
                  <span className="text-center">Visible</span>
                </div>
                <div className="divide-y divide-[var(--border-color)]">
                  {webAiModels.map((m) => {
                    const displayName = resolveModelDisplayName(m.model_id, modelLabels, aiModels);
                    const secondaryDisplayName = resolveModelSecondaryDisplayName(m.model_id, m.provider);
                    return (
                      <div key={m.id} className="px-4 py-3 hover:bg-[var(--bg-hover)]/5 transition-colors">
                        <div className="grid grid-cols-[minmax(0,1fr)_60px_60px] items-center gap-3">
                          <div className="min-w-0">
                            <span className="text-sm font-medium text-[var(--text-primary)] truncate block">{displayName}</span>
                            <span className="text-xs text-[var(--text-muted)] truncate block mt-0.5">{secondaryDisplayName}</span>
                          </div>
                          <div className="flex justify-center">
                            <Toggle
                              on={m.enabled}
                              onToggle={async () => {
                                await api.aiModel.update(m.id, { enabled: !m.enabled });
                                onModelsChanged();
                              }}
                            />
                          </div>
                          <div className="flex justify-center">
                            <Tooltip content={m.is_hidden ? "Show in Chat" : "Hide from Chat"}>
                              <button
                                onClick={async () => {
                                  await api.aiModel.update(m.id, { is_hidden: !m.is_hidden });
                                  onModelsChanged();
                                }}
                                className={`p-1 transition-colors ${m.is_hidden ? "text-[var(--text-muted)] hover:text-[var(--text-primary)]" : "text-[var(--accent-color)] hover:opacity-80"}`}
                              >
                                {m.is_hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                            </Tooltip>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="pt-2 space-y-2">
              <p className="text-xs text-[var(--text-secondary)] font-medium">Using browser targets</p>
              <p className="text-xs text-[var(--text-muted)]">
                Enabled browser targets appear as a dedicated <strong>Globe</strong> button in the Chat composer. Click it to pick a browser target and send your message.
              </p>
            </div>

          </section>
      </div>
    </div>
  );
}
