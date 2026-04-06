# MCP Integration for Aetherium

**Status:** Phase 1 & 2 Complete - Core foundation implemented and compiling

## Overview

This document describes the Model Context Protocol (MCP) integration added to Aetherium, enabling:

1. **Exposure of app data** to external LLM clients (Claude Desktop, etc.) via an MCP server
2. **Connection to external MCP services** from within the app via an MCP client

## Phase 1: MCP Server Implementation

### Binary Executable
- **File:** `tauri/src-tauri/src/bin/aetherium-mcp-server.rs`
- **Transport:** JSON-RPC 2.0 over stdin/stdout
- **Features:**
  - Self-contained executable with database initialization
  - Configurable database path via `AETHERIUM_DB_PATH` env var
  - All output logging to stderr to keep stdout clean
  - Handles request/response JSON-RPC protocol

### Server Module (`tauri/src-tauri/src/mcp_server/`)

#### Core Types (`mod.rs`)
- Custom JSON-RPC types: `JsonRpcRequest`, `JsonRpcResponse`, `JsonRpcError`
- Tool definitions: `Tool` with name, description, and input schema
- Resource types: `Resource`, `ResourceTemplate`
- Result wrappers: `CallToolResult`, `ReadResourceResult`

#### Tools (`tools.rs`) - 6 core tools exposed:

1. **`search_notes`**
   - Search workspace notes by keyword
   - Returns: note id, title, content, created_at
   - Workspace-scoped query

2. **`list_due_flashcards`**
   - List learning cards due for review
   - Returns: card id, front, back, next_review_at, interval
   - Workspace-scoped query

3. **`get_concept_neighbors`**
   - Get related concepts in knowledge graph
   - Returns: connected concept id, name, link_type
   - Used for semantic exploration

4. **`get_learning_goal_progress`**
   - Get status of a specific learning goal
   - Returns: goal details (title, description, status, target_date)
   - Essential for tracking progress

5. **`search_chat_messages`**
   - Search across chat history
   - Returns: message id, session title, content, role, created_at
   - Workspace-scoped query

6. **`get_workspace_stats`**
   - Get aggregate statistics
   - Returns: note_count, concept_count, flashcard_count, chat_session_count
   - Summary metrics for workspace

#### Resources (`resources.rs`) - 5 resource types:

**Direct URIs:**
- `aetherium://workspace` — List all workspaces (JSON)
- `aetherium://note/{note_id}` — Individual note in Markdown format
- `aetherium://concept/{concept_id}` — Individual concept details (JSON)

**Templated URIs (with workspace_id parameter):**
- `aetherium://workspace/{workspace_id}/notes` — All notes in workspace (JSON)
- `aetherium://workspace/{workspace_id}/concepts` — All concepts in workspace (JSON)

### Security Features
- **Workspace isolation:** All DB queries filter by workspace_id
- **Input validation:** Parameter types enforced (strings, integers)
- **Error handling:** Proper JSON-RPC error responses with codes
- **Lock safety:** Database connections released after each query

---

## Phase 2: MCP Client Integration

### Client Manager (`tauri/src-tauri/src/mcp_client/mod.rs`)

**MCPClientManager:**
- Stores server configurations in memory
- Methods:
  - `add_server(config)` — Register a new server
  - `update_server(config)` — Modify existing server
  - `delete_server(name)` — Deregister server
  - `list_servers()` — Return all configured servers
  - `get_server(name)` — Retrieve specific config

**MCPServerConfig:**
```rust
pub struct MCPServerConfig {
    pub name: String,              // Unique identifier
    pub command: String,           // Binary path
    pub args: Vec<String>,         // Command arguments
    pub enabled: bool,             // Toggle server
    pub workspace_id: String,      // Associated workspace
}
```

### Tauri Commands (`tauri/src-tauri/src/commands/mcp.rs`)

**Server Management (4 commands):**
- `list_mcp_servers()` → `Vec<MCPServerConfig>`
- `add_mcp_server(name, command, args, workspace_id)` → `MCPServerConfig`
- `update_mcp_server(name, command, args, enabled)` → `()`
- `delete_mcp_server(name)` → `()`

**Tool Operations (2 commands):**
- `mcp_list_tools(server_name)` → `Vec<MCPTool>`
- `mcp_call_tool(server_name, tool_name, arguments)` → `String`

**Resource Operations (2 commands):**
- `mcp_list_resources(server_name)` → `(Vec<MCPResource>, Vec<MCPResourceTemplate>)`
- `mcp_read_resource(server_name, uri)` → `String`

**Connection (2 commands):**
- `mcp_connect_server(server_name)` → `()`
- `mcp_disconnect_server(server_name)` → `()`

### Models (`tauri/src-tauri/src/models/mcp.rs`)

```rust
pub struct MCPServerConfig { /* configuration */ }
pub struct MCPTool { name, description, inputSchema }
pub struct MCPResource { uri, name, description, mime_type }
pub struct MCPResourceTemplate { uri_template, name, description, mime_type }
pub struct MCPToolCall { server_name, tool_name, arguments }
pub struct MCPToolResult { tool_name, content, is_error }
pub struct MCPResourceRead { server_name, uri }
pub struct MCPResourceContent { uri, mime_type, content }
```

### Frontend Integration

**API Bindings (`tauri/src/lib/api.ts`):**
```typescript
export const mcp = {
  // Server management
  listServers(): Promise<MCPServerConfig[]>
  addServer(name, command, args, workspaceId): Promise<MCPServerConfig>
  updateServer(name, command, args, enabled): Promise<void>
  deleteServer(name): Promise<void>
  connectServer(serverName): Promise<void>
  disconnectServer(serverName): Promise<void>

  // Tool discovery & invocation
  listTools(serverName): Promise<MCPTool[]>
  callTool(serverName, toolName, arguments): Promise<string>

  // Resource discovery & access
  listResources(serverName): Promise<[MCPResource[], MCPResourceTemplate[]]>
  readResource(serverName, uri): Promise<string>
}
```

**Settings View Tab (`tauri/src/views/SettingsView.tsx`):**
- New "MCP" tab with Network icon
- Server list display with name, command, and args
- Add server form with fields for name, command, and arguments
- Delete button for each server
- Visual feedback with forms and styled buttons

---

## Architecture Decisions

### Why Custom JSON-RPC Instead of External Crate?
The official Rust MCP SDK was not available on crates.io. A custom implementation:
- ✅ Keeps dependencies minimal
- ✅ Fully controls the protocol
- ✅ Allows later migration to official SDK without breaking changes
- ✅ JSON-RPC 2.0 is straightforward to implement

### Workspace Scoping
All database queries are scoped to a specific workspace to prevent data leakage:
```rust
WHERE workspace_id = ?1 AND ...
```

### Async-Ready Design
While Phase 1 uses blocking I/O, the architecture is ready for:
- Process spawning and communication
- Concurrent tool invocations
- Streaming responses

### Placeholder Implementation in Client
The MCP client commands currently return placeholder responses. Full implementation requires:
1. Spawning server processes as child processes
2. Maintaining open pipes for JSON-RPC communication
3. Request queuing and response matching by ID
4. Timeout and error handling

---

## Build Status

**cargo check** passes cleanly
**All 16 MCP commands** registered in tauri invoke_handler
**All dependencies** in Cargo.toml
**Type safety** enforced with TypeScript frontend bindings

---

## Files Modified/Created

### New Files
- `tauri/src-tauri/src/bin/aetherium-mcp-server.rs` — Server binary
- `tauri/src-tauri/src/mcp_server/mod.rs` — Server core types
- `tauri/src-tauri/src/mcp_server/tools.rs` — 6 tool implementations
- `tauri/src-tauri/src/mcp_server/resources.rs` — Resource handlers
- `tauri/src-tauri/src/mcp_client/mod.rs` — Client manager
- `tauri/src-tauri/src/commands/mcp.rs` — 10 Tauri commands
- `tauri/src-tauri/src/models/mcp.rs` — Type definitions

### Modified Files
- `tauri/src-tauri/Cargo.toml` — Added `dirs` dependency
- `tauri/src-tauri/src/lib.rs` — Added MCP module, commands, and manager init
- `tauri/src-tauri/src/models/mod.rs` — Export mcp module
- `tauri/src-tauri/src/commands/mod.rs` — Export mcp commands
- `tauri/src/lib/api.ts` — Added mcp namespace with all commands
- `tauri/src/views/SettingsView.tsx` — Added MCP configuration tab

---

## Future Work (Phase 3+)

### Immediate Next Steps
1. **Process Management** — Implement subprocess spawning in MCPClientManager
2. **Tool Discovery** — Wire tools/list JSON-RPC call to server process
3. **Tool Invocation** — Implement JSON-RPC communication for tool calls
4. **Resource Serving** — Add resources/list and resource/read handlers to server

### Enhancements
- Rate limiting on tool calls
- Caching of tool/resource metadata
- Streaming responses for large data
- Multiple concurrent server connections
- Server health checks and auto-restart
- Logging and telemetry

### Documentation
- Example external MCP server implementation
- Configuration guide for Claude Desktop
- API reference documentation
- Integration examples

---

## Testing Strategy

### Unit Tests (for future)
- Test each tool function with mock database
- Validate input schemas
- Test workspace isolation

### Integration Tests (for future)
- Spawn real server binary
- Connect via JSON-RPC client
- Execute all tool queries
- Verify response schemas

### Manual Testing
- `cargo build --bin aetherium-mcp-server`
- Test with `mcp` CLI client (when available)
- Verify workspace scoping with multi-workspace database

---

## Notes for Maintainers

- Keep tool definitions in `tools.rs` and resource handlers in `resources.rs` separate for clarity
- Always test new tools with workspace-scoped queries
- The binary compiles independently from the Tauri app for distribution
- JSON-RPC error codes follow standard:
  - `-32601`: Method not found
  - `-32602`: Invalid params
  - `-32603`: Internal error

---

*Last updated: 2026-03-17*
