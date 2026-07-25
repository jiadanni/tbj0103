import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, type MCPServerConfig } from "../../lib/api";

interface McpPreferencesPanelProps {
  mcpServers: MCPServerConfig[];
  onMcpServersChange: (servers: MCPServerConfig[]) => void;
}

export function McpPreferencesPanel({ mcpServers, onMcpServersChange }: McpPreferencesPanelProps) {
  const [showAddMcpServer, setShowAddMcpServer] = useState(false);
  const [newMcpName, setNewMcpName] = useState("");
  const [newMcpCommand, setNewMcpCommand] = useState("");
  const [newMcpArgs, setNewMcpArgs] = useState("");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-6">
      <div className="app-container">
        <h2 className="text-2xl font-bold mb-4">Model Context Protocol Servers</h2>

        <div className="mb-6">
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            Configure external MCP servers to integrate with external knowledge sources and tools.
          </p>
        </div>

        <div className="mb-6">
          <button
            onClick={() => setShowAddMcpServer(!showAddMcpServer)}
            className="flex items-center gap-2 px-4 py-2 rounded bg-[var(--accent-color)] text-white hover:opacity-90 transition"
          >
            <Plus size={18} /> Add MCP Server
          </button>
        </div>

        {showAddMcpServer && (
          <div className="mb-6 p-4 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)]">
            <h3 className="font-bold mb-4">New MCP Server</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Server Name</label>
                <input
                  type="text"
                  value={newMcpName}
                  onChange={(e) => setNewMcpName(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] focus:outline-none"
                  placeholder="e.g., my-knowledge-server"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Command</label>
                <input
                  type="text"
                  value={newMcpCommand}
                  onChange={(e) => setNewMcpCommand(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] focus:outline-none"
                  placeholder="e.g., /path/to/server-binary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Arguments (comma-separated)</label>
                <input
                  type="text"
                  value={newMcpArgs}
                  onChange={(e) => setNewMcpArgs(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] focus:outline-none"
                  placeholder="e.g., --config /path/config.json"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setShowAddMcpServer(false);
                    setNewMcpName("");
                    setNewMcpCommand("");
                    setNewMcpArgs("");
                  }}
                  className="px-4 py-2 rounded border border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    try {
                      await api.mcp.addServer(
                        newMcpName,
                        newMcpCommand,
                        newMcpArgs.split(",").map((s) => s.trim()).filter(Boolean),
                        "" // workspace_id
                      );
                      const servers = await api.mcp.listServers();
                      onMcpServersChange(servers);
                      setShowAddMcpServer(false);
                      setNewMcpName("");
                      setNewMcpCommand("");
                      setNewMcpArgs("");
                    } catch (err) {
                      console.error("Failed to add MCP server:", err);
                    }
                  }}
                  className="px-4 py-2 rounded bg-[var(--accent-color)] text-white hover:opacity-90 transition"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {mcpServers.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)] italic">No MCP servers configured yet.</p>
          ) : (
            mcpServers.map((server) => (
              <div key={server.id} className="p-4 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)]">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-bold">{server.name}</h4>
                    <p className="text-sm text-[var(--text-secondary)] font-mono">{server.command}</p>
                    {server.args.length > 0 && (
                      <p className="text-xs text-[var(--text-secondary)] mt-1">{server.args.join(" ")}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        try {
                          await api.mcp.deleteServer(server.name);
                          const servers = await api.mcp.listServers();
                          onMcpServersChange(servers);
                        } catch (err) {
                          console.error("Failed to delete MCP server:", err);
                        }
                      }}
                      className="p-2 rounded hover:bg-[var(--bg-hover)] transition text-red-500"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
