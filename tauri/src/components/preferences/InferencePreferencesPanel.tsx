import type { ReactNode } from "react";
import { Bot, FileText, Network, Plus, RefreshCw, Trash2 } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { type AppSettings, type OllamaModel, type SystemSpecs } from "../../lib/api";
import { applyHeadroom, formatBytes, inferHardwareModelGuidance } from "../../lib/modelSizing";
import { CompactMenuSelect } from "../CompactMenuSelect";
import { Tooltip } from "../Tooltip";
import { Toggle } from "../Toggle";
import { isMac } from "../../lib/platform";

function formatSystemName(specs: SystemSpecs): string {
  return [specs.os_name, specs.os_version].filter(Boolean).join(" ");
}

interface InferencePreferencesPanelProps {
  dbSettings: AppSettings;
  onSet: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  systemSpecs: SystemSpecs | null;
  systemSpecsLoading: boolean;
  systemSpecsError: string | null;
  systemGuidance: ReturnType<typeof inferHardwareModelGuidance> | null;
  onRefreshSystemSpecs: () => void;
  ollamaTestResult: { success: boolean; msg: string } | null;
  startingOllama: boolean;
  testingOllama: boolean;
  ollamaModelsLoading: boolean;
  hasLoadedOllamaModels: boolean;
  ollamaReachable: boolean | null;
  ollamaModels: OllamaModel[];
  nonEmbeddingOllamaModels: OllamaModel[];
  onToggleRemoteOllama: () => void;
  onStartOllamaServer: () => void;
  onTestOllamaConnection: () => void;
  onOllamaBaseUrlChange: (value: string) => void;
  testingMlx: boolean;
  mlxTestResult: { success: boolean; msg: string } | null;
  onTestMlxConnection: () => void;
  modelsSection: ReactNode;
}

export function InferencePreferencesPanel({
  dbSettings,
  onSet,
  systemSpecs,
  systemSpecsLoading,
  systemSpecsError,
  systemGuidance,
  onRefreshSystemSpecs,
  ollamaTestResult,
  startingOllama,
  testingOllama,
  ollamaModelsLoading,
  hasLoadedOllamaModels,
  ollamaReachable,
  ollamaModels,
  nonEmbeddingOllamaModels,
  onToggleRemoteOllama,
  onStartOllamaServer,
  onTestOllamaConnection,
  onOllamaBaseUrlChange,
  testingMlx,
  mlxTestResult,
  onTestMlxConnection,
  modelsSection,
}: InferencePreferencesPanelProps) {
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-8">
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-[var(--text-secondary)]">Detected hardware guidance</p>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Based on detected memory and available compute.
            </p>
          </div>
          <button
            onClick={onRefreshSystemSpecs}
            disabled={systemSpecsLoading}
            className="text-[10px] text-[var(--accent-color)] hover:underline flex items-center gap-1 disabled:opacity-50"
          >
            {systemSpecsLoading ? <RefreshCw size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            Refresh specs
          </button>
        </div>

        {systemSpecs ? (
          <>
            {systemGuidance && (
              <div className="rounded-lg border border-[var(--accent-color)]/20 bg-[var(--accent-color)]/8 px-3 py-2.5">
                <p className="text-[11px] font-semibold text-[var(--text-primary)]">{systemGuidance.headline}</p>
                <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{systemGuidance.summary}</p>
                <p className="mt-1 text-[10px] text-[var(--text-secondary)]">{systemGuidance.basis}</p>
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">System</p>
                <p className="mt-0.5 text-xs text-[var(--text-primary)]">{formatSystemName(systemSpecs)}</p>
                <p className="text-[10px] text-[var(--text-secondary)]">{systemSpecs.cpu_arch}</p>
              </div>
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">CPU</p>
                <p className="mt-0.5 text-xs text-[var(--text-primary)]">{systemSpecs.cpu_brand}</p>
                <p className="text-[10px] text-[var(--text-secondary)]">
                  {systemSpecs.physical_cores ? `${systemSpecs.physical_cores} physical` : "Physical cores unavailable"} / {systemSpecs.logical_cores} logical
                </p>
              </div>
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">Memory</p>
                <p className="mt-0.5 text-xs text-[var(--text-primary)]">{formatBytes(systemSpecs.total_memory_bytes)} total</p>
                <p className="text-[10px] text-[var(--text-secondary)]">{formatBytes(systemSpecs.available_memory_bytes)} available now</p>
              </div>
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                  {systemSpecs.gpu_name ? "GPU" : "Swap"}
                </p>
                <p className="mt-0.5 text-xs text-[var(--text-primary)]">
                  {systemSpecs.gpu_name
                    ? systemSpecs.gpu_name
                    : `${formatBytes(systemSpecs.total_swap_bytes)} configured`}
                </p>
                <p className="text-[10px] text-[var(--text-secondary)]">
                  {systemSpecs.gpu_name
                    ? (systemSpecs.gpu_memory_bytes
                      ? `${formatBytes(systemSpecs.gpu_memory_bytes)} VRAM`
                      : (systemSpecs.gpu_detection_source || "GPU memory unavailable"))
                    : (systemSpecs.host_name ? systemSpecs.host_name : (systemSpecs.kernel_version || "Kernel version unavailable"))}
                </p>
              </div>
            </div>

            {systemGuidance?.caution && (
              <p className="text-[10px] text-[var(--text-secondary)]">{systemGuidance.caution}</p>
            )}

            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5 space-y-3">
              <div>
                <p className="text-[11px] font-semibold text-[var(--text-primary)]">Memory headroom</p>
                <p className="mt-1 text-[10px] text-[var(--text-secondary)] leading-relaxed">
                  {(() => {
                    const osLower = systemSpecs.os_name.toLowerCase();
                    const isMac = osLower.includes("mac") || osLower.includes("darwin");
                    const isWindows = (osLower.includes("windows") || osLower.includes("win32") || osLower.includes("win64") || osLower.includes("microsoft")) && !osLower.includes("darwin") && !osLower.includes("mac");
                    const isLinux = osLower.includes("linux");

                    const isMacUnified = isMac && ["aarch64", "arm64"].includes(systemSpecs.cpu_arch.toLowerCase());
                    const hasGpu = (systemSpecs.gpu_memory_bytes ?? 0) > 0;
                    const gpuNameLower = (systemSpecs.gpu_name || "").toLowerCase();

                    const isNvidia = gpuNameLower.includes("nvidia") || gpuNameLower.includes("geforce") || gpuNameLower.includes("rtx");
                    const isAmd = gpuNameLower.includes("amd") || gpuNameLower.includes("radeon") || gpuNameLower.includes("navi");
                    const isIntel = gpuNameLower.includes("intel");

                    if (isMacUnified) {
                      return (
                        <>
                          Unified memory reserved for system and other apps. Check usage in macOS <strong>Activity Monitor</strong> (Memory tab).
                        </>
                      );
                    }

                    const reserveText = hasGpu
                      ? "RAM and VRAM reserved for system and other apps (larger of GB or % applies per pool)."
                      : "RAM reserved for system and other apps (larger of GB or % applies).";

                    const checkText = (() => {
                      if (isMac) {
                        return hasGpu
                          ? "Check usage in macOS Activity Monitor (Memory/GPU History)."
                          : "Check usage in macOS Activity Monitor (Memory tab).";
                      }
                      if (isWindows) {
                        return hasGpu
                          ? "Check usage in Task Manager (Performance → Memory/GPU)."
                          : "Check usage in Task Manager (Performance → Memory).";
                      }
                      if (isLinux) {
                        if (hasGpu) {
                          if (isNvidia) { return <>Check VRAM via <code>nvidia-smi</code> or <code>nvtop</code>, RAM via <code>free -h</code>.</>; }
                          if (isAmd) { return <>Check VRAM via <code>radeontop</code> or <code>rocm-smi</code>, RAM via <code>free -h</code>.</>; }
                          if (isIntel) { return <>Check VRAM via <code>intel_gpu_top</code>, RAM via <code>free -h</code>.</>; }
                          return <>Check GPU usage via diagnostics, RAM via <code>free -h</code>.</>;
                        }
                        return <>Check usage via <code>free -h</code> or <code>htop</code>.</>;
                      }
                      return <>Check usage in your system&apos;s activity monitor.</>;
                    })();

                    return (
                      <>
                        {reserveText} {checkText}
                      </>
                    );
                  })()}
                </p>
              </div>

              {(systemSpecs.gpu_memory_bytes ?? 0) > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">VRAM headroom</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                      <input
                        type="number"
                        min={0}
                        max={1024}
                        step={0.1}
                        value={dbSettings.vram_headroom_gb}
                        onChange={(e) => onSet("vram_headroom_gb", Math.max(0, Number(e.target.value) || 0))}
                        className="w-20 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)]"
                      />
                      GB
                    </label>
                    <label className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                      <input
                        type="number"
                        min={0}
                        max={90}
                        step={1}
                        value={dbSettings.vram_headroom_percent}
                        onChange={(e) => onSet("vram_headroom_percent", Math.min(90, Math.max(0, Math.round(Number(e.target.value) || 0))))}
                        className="w-16 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)]"
                      />
                      %
                    </label>
                    <span className="text-[10px] text-[var(--text-secondary)]">
                      {(() => {
                        const r = applyHeadroom(
                          systemSpecs.gpu_memory_bytes ?? 0,
                          dbSettings.vram_headroom_gb,
                          dbSettings.vram_headroom_percent,
                        );
                        return `Effective: ${formatBytes(r.effectiveBytes)} of ${formatBytes(systemSpecs.gpu_memory_bytes ?? 0)}${r.reservedBytes > 0 ? ` (${formatBytes(r.reservedBytes)} reserved)` : ""}`;
                      })()}
                    </span>
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                  {systemSpecs.os_name.toLowerCase().includes("mac") && ["aarch64", "arm64"].includes(systemSpecs.cpu_arch.toLowerCase())
                    ? "Memory headroom (unified)"
                    : "RAM headroom"}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                    <input
                      type="number"
                      min={0}
                      max={1024}
                      step={0.1}
                      value={dbSettings.ram_headroom_gb}
                      onChange={(e) => onSet("ram_headroom_gb", Math.max(0, Number(e.target.value) || 0))}
                      className="w-20 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)]"
                    />
                    GB
                  </label>
                  <label className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                    <input
                      type="number"
                      min={0}
                      max={90}
                      step={1}
                      value={dbSettings.ram_headroom_percent}
                      onChange={(e) => onSet("ram_headroom_percent", Math.min(90, Math.max(0, Math.round(Number(e.target.value) || 0))))}
                      className="w-16 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)]"
                    />
                    %
                  </label>
                  <span className="text-[10px] text-[var(--text-secondary)]">
                    {(() => {
                      const r = applyHeadroom(
                        systemSpecs.total_memory_bytes,
                        dbSettings.ram_headroom_gb,
                        dbSettings.ram_headroom_percent,
                      );
                      return `Effective: ${formatBytes(r.effectiveBytes)} of ${formatBytes(systemSpecs.total_memory_bytes)}${r.reservedBytes > 0 ? ` (${formatBytes(r.reservedBytes)} reserved)` : ""}`;
                    })()}
                  </span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <p className="text-[11px] text-[var(--text-secondary)]">
            {systemSpecsLoading ? "Reading local system specs..." : (systemSpecsError || "System specs are not available yet.")}
          </p>
        )}
      </div>

      <section className="space-y-3" data-pref-section>
        <div className="pb-1.5 border-b border-[var(--border-color)]">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Local inference providers</h3>
          <p className="text-xs text-[var(--text-muted)]/80 mt-1">
            Configure your local inference engines. Use the default local server for a standard experience, or enable MLX and llama.cpp for optimized hardware performance.
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 space-y-4">
          <div className="flex items-start gap-3">
            <Toggle
              on={dbSettings.ollama_remote_enabled}
              onToggle={onToggleRemoteOllama}
            />
            <div>
              <p className="text-sm text-[var(--text-secondary)]">Remote Ollama</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Send Ollama requests to another machine on your network.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Toggle
              on={dbSettings.auto_start_ollama}
              disabled={dbSettings.ollama_remote_enabled}
              onToggle={() => onSet("auto_start_ollama", !dbSettings.auto_start_ollama)}
            />
            <div>
              <p className="text-sm text-[var(--text-secondary)]">Auto-start Ollama</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {dbSettings.ollama_remote_enabled
                  ? "Disabled in remote mode because the server runs on another machine."
                  : "Automatically start the Ollama server when the app launches."}
              </p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3 mb-1">
              <label className="text-xs text-[var(--text-secondary)]">Server URL</label>
              <div className="flex items-center gap-3">
                <button
                  onClick={onStartOllamaServer}
                  disabled={dbSettings.ollama_remote_enabled || startingOllama || testingOllama}
                  className="text-[10px] text-[var(--accent-color)] hover:underline flex items-center gap-1 disabled:opacity-50"
                >
                  {startingOllama ? <RefreshCw size={10} className="animate-spin" /> : <Bot size={10} />}
                  Start server
                </button>
                <button
                  onClick={onTestOllamaConnection}
                  disabled={testingOllama || startingOllama}
                  className="text-[10px] text-[var(--accent-color)] hover:underline flex items-center gap-1 disabled:opacity-50"
                >
                  {testingOllama ? <RefreshCw size={10} className="animate-spin" /> : <Network size={10} />}
                  Test Connection
                </button>
              </div>
            </div>
            <input
              value={dbSettings.ollama_base_url}
              onChange={(e) => onOllamaBaseUrlChange(e.target.value)}
              placeholder={dbSettings.ollama_remote_enabled ? "http://macbook.local:11434" : "http://localhost:11434"}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
            />
            <p className="text-[10px] text-[var(--text-muted)] mt-1.5">
              {dbSettings.ollama_remote_enabled
                ? "Use a LAN address such as http://macbook.local:11434 or a reserved 192.168.x.x address."
                : "Enable auto-start to try to start the server on launch when you use the default local address."}
            </p>
            {ollamaTestResult && (
              <p className={`text-[10px] mt-1.5 font-medium ${ollamaTestResult.success ? "text-green-400" : "text-red-400"}`}>
                {ollamaTestResult.msg}
              </p>
            )}
            {ollamaModelsLoading && (
              <p className="text-[10px] mt-1.5 text-[var(--text-muted)]">
                Loading available models...
              </p>
            )}
            {hasLoadedOllamaModels && !ollamaModelsLoading && ollamaReachable === false && !testingOllama && !startingOllama && (
              <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <div className="flex items-center gap-2 text-red-400 mb-1">
                  <Network size={14} />
                  <span className="text-xs font-semibold">Ollama unavailable</span>
                </div>
                <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                  Aetherium could not reach Ollama at this URL. Start it manually with:
                  <code className="block mt-1.5 p-1.5 rounded bg-[var(--bg-primary)] font-mono text-[10px] text-[var(--text-secondary)]">
                    ollama serve
                  </code>
                  Or enable auto-start above for the default local address.
                </p>
              </div>
            )}
            {hasLoadedOllamaModels && !ollamaModelsLoading && ollamaReachable === true && nonEmbeddingOllamaModels.length === 0 && !testingOllama && !startingOllama && (
              <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-center gap-2 text-amber-500 mb-1">
                  <Bot size={14} />
                  <span className="text-xs font-semibold">No models found</span>
                </div>
                <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                  Ollama is connected but no models are installed yet. Pull any model you want to use, then refresh the connection.
                  <code className="block mt-1.5 p-1.5 rounded bg-[var(--bg-primary)] font-mono text-[10px] text-[var(--text-secondary)]">
                    ollama pull &lt;model-name&gt;
                  </code>
                </p>
              </div>
            )}
          </div>
        </div>

        {isMac && (
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <div>
                <label className="text-sm text-[var(--text-secondary)]">MLX</label>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Apple Silicon local inference with unified-memory friendly acceleration.
                </p>
              </div>
              <button
                onClick={onTestMlxConnection}
                disabled={testingMlx}
                className="text-[10px] text-[var(--accent-color)] hover:underline flex items-center gap-1"
              >
                {testingMlx ? <RefreshCw size={10} className="animate-spin" /> : <Network size={10} />}
                Test Connection
              </button>
            </div>
            <input
              value={dbSettings.mlx_base_url}
              onChange={(e) => {
                onSet("mlx_base_url", e.target.value);
              }}
              placeholder="http://localhost:8080"
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
            />
            {mlxTestResult && (
              <p className={`text-[10px] mt-1.5 font-medium ${mlxTestResult.success ? "text-green-400" : "text-red-400"}`}>
                {mlxTestResult.msg}
              </p>
            )}
            <p className="text-[10px] text-[var(--text-muted)]">
              Run via: <code className="bg-[var(--bg-elevated)] px-1 rounded">mlx_lm.server --model ...</code>
            </p>
          </div>
        )}

        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 space-y-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <label className="text-sm text-[var(--text-secondary)]">llama.cpp (GGUF)</label>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Add local GGUF files for embedded inference without a separate server.
              </p>
            </div>
            <button
              onClick={async () => {
                try {
                  const selected = await openDialog({
                    multiple: true,
                    filters: [{ name: "GGUF Model", extensions: ["gguf"] }],
                  });
                  if (selected && Array.isArray(selected)) {
                    const currentPaths = dbSettings.llamacpp_model_paths || [];
                    const newPaths = [...new Set([...currentPaths, ...selected])];
                    onSet("llamacpp_model_paths", newPaths);
                  }
                } catch (err) {
                  console.error("Failed to open file picker:", err);
                }
              }}
              className="text-[10px] text-[var(--accent-color)] hover:underline flex items-center gap-1"
            >
              <Plus size={10} /> Add GGUF File
            </button>
          </div>

          <div className="space-y-1.5">
            {(dbSettings.llamacpp_model_paths || []).map((path) => (
              <div key={path} className="flex items-center justify-between gap-2 p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] group">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText size={12} className="text-[var(--text-muted)] shrink-0" />
                  <Tooltip content={path}>
                    <span className="text-[11px] text-[var(--text-primary)] truncate">
                      {path.split("/").pop()}
                    </span>
                  </Tooltip>
                </div>
                <button
                  onClick={() => {
                    const next = dbSettings.llamacpp_model_paths.filter((p) => p !== path);
                    onSet("llamacpp_model_paths", next);
                  }}
                  className="p-1 rounded hover:bg-red-400/10 text-[var(--text-muted)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
            {(dbSettings.llamacpp_model_paths || []).length === 0 && (
              <p className="text-[10px] text-[var(--text-muted)] italic">No GGUF models added yet.</p>
            )}
          </div>
          <p className="text-[10px] text-[var(--text-muted)]">
            Embedded inference via llama.cpp with local acceleration when available.
          </p>
        </div>
      </section>

      <section className="space-y-3" data-pref-section>
        <div className="pb-1.5 border-b border-[var(--border-color)]">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Dual-model execution</h3>
          <p className="text-xs text-[var(--text-muted)]/80 mt-1">
            Choose whether the draft and refine models run one after the other or at the same time.
          </p>
        </div>
        <CompactMenuSelect
          label="Execution"
          value={dbSettings.dual_model_execution_mode}
          options={[
            { value: "serial", label: "Serial: draft, then refine" },
            { value: "parallel", label: "Parallel: draft and refine together" },
          ]}
          onChange={(val) => onSet("dual_model_execution_mode", val as AppSettings["dual_model_execution_mode"])}
          widthClassName="w-full"
        />
        <p className="text-[10px] text-[var(--text-muted)]">
          Serial is steadier and uses one Ollama generation at a time. Parallel feels faster overall, but can use more compute and memory.
        </p>
      </section>

      <section className="space-y-3" data-pref-section>
        <div className="pb-1.5 border-b border-[var(--border-color)]">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Embedding model</h3>
          <p className="text-xs text-[var(--text-muted)]/80 mt-1">
            Choose the model used for embeddings and retrieval.
          </p>
        </div>

        <div className="space-y-2">
          {(() => {
            const isModelInstalled = (name: string) =>
              ollamaModels.length === 0 ||
              ollamaModels.some((model) => model.name === name || model.name.startsWith(`${name}:`));
            const nomicInstalled = isModelInstalled("nomic-embed-text");
            const isCustom = dbSettings.embedding_model !== "nomic-embed-text";
            const customInstalled = !isCustom || isModelInstalled(dbSettings.embedding_model);

            return (
              <>
                <div className="flex flex-row flex-wrap gap-x-6 gap-y-2 mb-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="embedding_model"
                      checked={!isCustom}
                      onChange={() => onSet("embedding_model", "nomic-embed-text")}
                      className="accent-[var(--accent-color)]"
                    />
                    <span className="text-sm text-[var(--text-primary)]">nomic-embed-text</span>
                    <span className="text-[10px] text-[var(--text-muted)]">(default)</span>
                    {!nomicInstalled && hasLoadedOllamaModels && (
                      <span className="rounded border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
                        not installed
                      </span>
                    )}
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="embedding_model"
                      checked={isCustom}
                      onChange={() => onSet("embedding_model", "")}
                      className="accent-[var(--accent-color)]"
                    />
                    <span className="text-sm text-[var(--text-primary)]">Custom</span>
                  </label>
                </div>

                {isCustom && (
                  <div className="ml-6 space-y-2">
                    <input
                      value={dbSettings.embedding_model}
                      onChange={(e) => onSet("embedding_model", e.target.value)}
                      placeholder="e.g. mxbai-embed-large"
                      className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                    />
                    {!customInstalled && dbSettings.embedding_model && hasLoadedOllamaModels && (
                      <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2">
                        <p className="text-[11px] font-medium text-red-400">Model not installed</p>
                        <p className="mt-0.5 text-[10px] text-red-400/80">
                          Run: <code className="rounded bg-[var(--bg-primary)] px-1">ollama pull {dbSettings.embedding_model}</code>
                        </p>
                      </div>
                    )}
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 space-y-1">
                      <p className="text-[11px] font-medium text-amber-400">Before switching</p>
                      <ul className="ml-3 list-disc space-y-0.5 text-[10px] text-amber-400/80">
                        <li>Pull the model first: <code className="rounded bg-[var(--bg-primary)] px-1">ollama pull model-name</code></li>
                        <li>Changing models invalidates existing embeddings for memories, documents, and artifacts</li>
                        <li>You will need to re-index data for search and deduplication to work correctly</li>
                      </ul>
                    </div>
                  </div>
                )}

                {!isCustom && !nomicInstalled && hasLoadedOllamaModels && (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2">
                    <p className="text-[11px] font-medium text-red-400">Model not installed — embeddings are disabled</p>
                    <p className="mt-0.5 text-[10px] text-red-400/80">
                      Run: <code className="rounded bg-[var(--bg-primary)] px-1">ollama pull nomic-embed-text</code>
                    </p>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </section>

      </div>
      {modelsSection}
    </div>
  );
}
