# GEMINI.md — Aetherium Project Context

This file provides essential context and instructions for AI agents working on the Aetherium project.

## Project Overview
**Aetherium** is a local-first AI learning companion that combines AI chat, source grounding (RAG), bidirectional linking (Knowledge Graph), and spaced repetition. It is powered by local **Ollama** models to ensure complete privacy.

### Dual Implementations
- **Tauri (Active Target):** Cross-platform (macOS, Windows, Linux) using Rust (backend) and React + TypeScript (frontend). This is the primary development target.
- **Swift/macOS (On Hold):** Native macOS implementation using SwiftUI and SwiftData. Feature-complete but currently secondary to the Tauri port.

## Technology Stack
- **Backend:** Rust, Tauri v2, SQLite (rusqlite), Ollama (local AI), reqwest, serde.
- **Frontend:** React 18, TypeScript (strict), Tailwind CSS v3, Zustand (state management), Vite.
- **Native macOS:** Swift 5.9, SwiftUI, SwiftData, LocalAuthentication.

## Directory Structure
- `/tauri`: Root of the active Tauri implementation.
    - `/src`: React + TypeScript frontend.
        - `/views`: Page-level components (Dashboard, Chat, Knowledge Graph, etc.).
        - `/components`: Reusable UI components.
        - `/lib/api.ts`: **Single source of truth** for all Tauri IPC (`invoke`) calls.
        - `/stores`: Zustand global state management.
    - `/src-tauri`: Rust backend.
        - `/src/commands`: Tauri command handlers (should be thin wrappers).
        - `/src/services`: Core business logic (RAG, search, linking, etc.).
        - `/src/models`: Rust structs and database models.
        - `/src/schema.sql`: **Source of truth** for the SQLite database schema.
- `/Sources/Aetherium`: Source code for the Swift/macOS implementation.
- `/Tests/AetheriumTests`: Unit and integration tests for the Swift implementation.
- `/docs`: Detailed documentation for specific modules (MCP, Tauri port analysis, etc.).

## Development Workflow

### Building and Running
- **Tauri App (Dev):**
  ```bash
  cd tauri
  npm install
  npm run tauri dev
  ```
- **Tauri App (Check):**
  ```bash
  cd tauri
  npm run typecheck    # TypeScript
  cargo check --manifest-path src-tauri/Cargo.toml  # Rust
  ```
- **Swift App:**
  ```bash
  swift build
  swift run Aetherium
  ```

### Testing
- **Swift Tests:** `swift test` or `./test.sh`.
- **Tauri Tests:** `cd tauri && npm test` (Vitest) and `cargo test --manifest-path src-tauri/Cargo.toml`.

### Linting
- Run the root script: `./lint.sh` (Runs SwiftLint, ESLint, TSC, and Cargo Clippy).

## Key Development Conventions

### 1. Tauri Backend (Rust)
- **Thin Commands:** Command handlers in `src-tauri/src/commands/` should validate input and delegate to services.
- **SQLite:** Always use explicit column names in `INSERT` and `SELECT`. Schema changes must be additive in `schema.sql`.
- **Error Handling:** Commands should return `Result<T, String>` where the error is a human-readable string.

### 2. Tauri Frontend (React/TS)
- **Typed IPC:** All backend calls MUST go through `tauri/src/lib/api.ts`.
- **State:** Use **Zustand** stores for cross-page state. Keep actions stable to avoid `useEffect` loops.
- **Styling:** Use **Tailwind CSS**. Avoid custom CSS.
- **Layout:** For scrolling containers in flex layouts, remember the `min-h-0` pattern on parents.
- **Linux Compatibility:** Attach `onDragRegionMouseDown` to all `data-tauri-drag-region` elements for reliable window dragging.

### 3. Swift Implementation
- Use **SwiftData** (@Model) for persistence.
- Pure **SwiftUI** for views.
- **SecurityManager** handles biometric authentication.

## Critical Files
- `README.md`: High-level project overview.
- `ARCHITECTURE.md`: Deep dive into system design.
- `AGENTS.md`: Detailed instructions for AI coding agents.
- `todo.md`: Active roadmap for the Tauri implementation.
- `tauri/src-tauri/src/schema.sql`: Database schema definition.
- `tauri/src/lib/api.ts`: IPC interface definition.

## Safety Protocols
- **No Data Leaks:** Never add telemetry or external logging that bypasses the local-first principle.
- **Persistence:** Never discard uncommitted changes (`git checkout .`) without a diff.
- **Ollama:** Ensure the user has Ollama running on `:11434` for AI-related tasks.
