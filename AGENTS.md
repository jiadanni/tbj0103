# AGENTS.md — Aetherium

Guidance for AI coding agents (Copilot, Claude, Codex, etc.) working in this repository.

---

## Critical Rule: "Zero-Regression Policy"
1. **Research Phase:** Find all dependencies before changing an interface/struct.
2. **Strategy Phase:** Propose surgical edits. Avoid rewriting large blocks of code.
3. **Execution Phase:** After every file write, run `npm run typecheck` or `cargo check`.
4. **Safety Check:** If a `git diff` shows more lines removed than added (unless requested), STOP and explain the discrepancy.

## Operational Guardrails

### 1. The "Immediate Validation" Mandate
AI agents often assume a change is correct if the tool call succeeds. You must strictly follow technical verification protocols.
*   **TypeScript/React:** Run `npm run typecheck` after changes. DO NOT ignore errors in unrelated files; a change in an interface requires fixing all usages.
*   **Rust/Backend:** Run `cargo check --manifest-path src-tauri/Cargo.toml` after backend changes.
*   **Logic/UI:** Run only the relevant test file (e.g., `npx vitest run src/tests/views/ChatView.test.tsx`) to ensure no existing functionality was broken.

### 2. Surgical Editing vs. Rewrite
*   **Prefer surgical editing** for files over 200 lines. Avoid rewriting the entire file unless necessary.
*   **Anti-Regression Check:** After a modification, run `git diff --stat`. If you see a massive deletion (e.g., -500 lines) that wasn't explicitly requested, you must REVERT immediately and use a more surgical approach.
*   **Marker Usage:** When adding new features to large components, search for existing logic "anchors" to ensure you are inserting code into the correct scope.

### 3. Interface & Mock Consistency
If you modify a **Rust Struct** or a **TypeScript Interface**:
1.  Search the entire codebase for all occurrences of that symbol.
2.  Update all usage sites, including **Mock Objects** in test files.
3.  A task is not complete until `npm run typecheck` and `cargo check` pass project-wide.

### 4. Large File Strategy (e.g., `ChatView.tsx`)
Files like `src/views/ChatView.tsx` are critical and highly complex.
*   Before editing, read the targeted section with at least 20 lines of context.
*   Double-check brace nesting (`{}`) after every insertion.
*   If a feature (like file attachments or prompt polishing) is already present, DO NOT reimplement it; safely extend it.

### 5. AI Tooling Assumptions
*   Never assume Ollama is running or a specific model is pulled during a test.
*   Always check `apiMocks` in tests to ensure they return valid, expected data shapes for the component being tested.

---

## Project Overview

**Aetherium** is a local-first AI learning companion. It exists as two parallel implementations:

| Codebase | Language / Framework | Entry point |
|---|---|---|
| **Swift / macOS** | Swift 5.9 + SwiftUI + SwiftData | `Sources/Aetherium/` |
| **Tauri / cross-platform** | Rust (Tauri v2) + React + TypeScript | `tauri/` |

Both apps share the same feature set and data model; the Tauri port is the active development target.

---

## Repository Layout

```
tbj0103/
├── Sources/Aetherium/          # Swift app (macOS)
│   ├── Models/                 # SwiftData models
│   ├── Views/                  # SwiftUI views
│   ├── Services/               # Business logic
│   ├── Demo/                   # Demo mode infrastructure
│   ├── Managers/               # App-wide managers (theme, shortcuts)
│   └── Plugins/                # Plugin system
├── Tests/AetheriumTests/       # Swift tests (XCTest)
├── tauri/                      # Tauri cross-platform app
│   ├── src/                    # React + TypeScript frontend
│   │   ├── views/              # Page-level components
│   │   ├── components/         # Shared UI components
│   │   ├── lib/api.ts          # All Tauri invoke() calls
│   │   ├── stores/             # Zustand stores
│   │   └── styles/             # Tailwind CSS
│   └── src-tauri/              # Rust backend
│       ├── src/commands/       # Tauri command handlers
│       ├── src/services/       # Business-logic services
│       ├── src/models/         # Rust structs / DB models
│       ├── src/db/             # SQLite connection pool
│       ├── src/ollama/         # Ollama HTTP client
│       └── schema.sql          # SQLite schema (source of truth)
├── ARCHITECTURE.md
├── TAURI_PORT_ANALYSIS.md
└── todo.md
```

---

## Tauri App — Key Conventions

### Frontend (React / TypeScript)

- **All Tauri IPC calls live in `tauri/src/lib/api.ts`** — never call `invoke()` directly from views. Add a typed wrapper in `api.ts` first.
- Routes and navigation are defined in `tauri/src/App.tsx`. Every view file in `src/views/` must have a corresponding route.
- State management uses **Zustand** (`src/stores/`). Prefer store actions over local component state for anything that persists across navigation.
- The Tauri app supports split-pane workspace contexts. Components that must work in both single-pane and split-pane layouts should use the scoped helpers in `src/lib/workspacePane.tsx` (`useScopedWorkspace`, `useScopedChat`, `useScopedProjects`) instead of reading only the global active workspace/chat state.
- In split mode, treat chat session collections, selected project filters, and "new chat" intents as **pane-local state**. Do not let one pane's fetch or effect overwrite the other pane's visible chat list.
- When toggling split mode, preserve chat selection explicitly. Entering split mode should seed the pane from the current route or active chat, and exiting split mode should restore the primary pane's `chatSessionId` back to the single-pane active chat state.
- After refreshing projects for a workspace, reconcile stale global and per-pane `projectId` selections immediately. Invalid project filters can make chats appear to disappear even when the underlying sessions still exist.
- Styling is **Tailwind CSS v3** with `@tailwindcss/typography`. No custom CSS files except `src/styles/`.
- **Flex overflow pattern:** Any flex-column container whose children need to scroll must have `min-h-0` on every flex item in the height chain. Without it, flex items default to `min-height: auto` and `overflow-y-auto` on a child will never activate. The main content Panel in `Layout.tsx` and the active-chat container in `ChatView.tsx` both rely on this.
- TypeScript strict mode is on. Run `npx tsc --noEmit` to verify — it must exit 0 before committing.

#### React / Zustand Effect Safety

- Treat `useEffect` dependency arrays as a common source of render loops, especially when they include functions returned from custom hooks or store-scoped wrappers.
- If a custom hook returns action functions such as setters, keep those function references stable across renders when possible. Avoid creating fresh arrow-function wrappers on every render unless the consumer explicitly expects that.
- Before adding a returned setter or action to a `useEffect` dependency array, verify that its identity is stable. If it is not stable, either stabilize it in the hook or restructure the effect so it does not depend on the unstable wrapper.
- When a bug only appears in a specific layout or mode, such as split-pane versus single-pane, treat that as a render-topology clue and inspect the full cycle: render -> effect -> store update -> re-render.
- For React or Zustand infinite-loop bugs, document the exact repro path and check custom hooks, effect dependencies, and store updates before assuming the issue is in the view alone.

### Backend (Rust / Tauri)

- **SQLite is the single source of truth.** The schema lives in `src-tauri/src/schema.sql`. All migrations are additive `CREATE TABLE IF NOT EXISTS` statements; never drop or alter existing columns.
- Tauri commands go in `src-tauri/src/commands/`, one file per domain (note, chat, search, etc.). Register new commands in `src-tauri/src/lib.rs` inside the `.invoke_handler(tauri::generate_handler![...])` call.
- Services (`src-tauri/src/services/`) contain business logic that commands delegate to. Commands should be thin — validate input, acquire the DB lock, call a service, return the result.
- Use `rusqlite` through the app’s `r2d2_sqlite` connection pool (`DbState`). Acquire a connection with `state.0.get().map_err(|e| e.to_string())?`.
- All command return types must be `Result<T, String>` where the error string is a human-readable message.
- Run `cargo check` to verify — it must exit 0 before committing.

### Window Management (Linux)

- On Linux, `data-tauri-drag-region` alone is unreliable for window dragging. Every drag-region element must **also** attach the `onDragRegionMouseDown` handler exported from `src/components/WindowControls.tsx`, which calls `getCurrentWindow().startDragging()` programmatically.
- The `WindowControls` component renders minimize / maximize / close buttons **only on Linux** (macOS uses native traffic lights). It uses an explicit `isMaximized()` check to toggle maximize/unmaximize — do **not** use `toggleMaximize()`.
- Any new top-level view or screen that renders a drag region (e.g., a loading/splash screen) must import and apply `onDragRegionMouseDown`.

### Capabilities / Permissions

- File-system permissions are declared in `src-tauri/capabilities/default.json`.
- Use Tauri v2 permission identifiers: `fs:allow-read-file`, `fs:allow-write-file`, `fs:allow-mkdir`, `fs:allow-remove`, etc. The old v1 names (`fs:allow-create-dir`, `fs:allow-remove-file`) are invalid and will cause build errors.
- Window-management permissions (`core:window:allow-minimize`, `allow-maximize`, `allow-unmaximize`, `allow-is-maximized`, `allow-close`, `allow-start-dragging`) are already declared. If you add new window API calls, add the corresponding permission to `default.json`.

---

## Swift App — Key Conventions

- Models use `@Model` (SwiftData). Never use `NSManagedObject` or Core Data directly.
- Views are pure SwiftUI — no UIKit / AppKit unless strictly necessary.
- Workspace scoping: notes, documents, flashcards, and web captures belong to a `Workspace`. Projects are chat-only containers.
- Authentication goes through `SecurityManager`. Check `SecurityManager.shared.isAuthenticated` before showing sensitive content.
- Demo mode check: before any destructive action, check `DemoModeManager.shared.isActive` and show the reset/exit sheet instead.

---

## Build & Check Commands

### Swift

```bash
# From repo root
swift build                     # compile only
swift test                      # run all tests
```

### Tauri (tool paths may vary by machine / OS)

```bash
# TypeScript check
cd tauri
npx tsc --noEmit

# Frontend tests
npx vitest run

# Rust check
cargo check --manifest-path tauri/src-tauri/Cargo.toml

# Run dev server (requires Ollama running on :11434 for AI features)
cd tauri
npm run tauri dev
```

> **Note:** `node`, `npm`, and `cargo` may resolve differently across macOS, Linux, and Windows setups. Use the local machine’s working toolchain path when they are not already on `$PATH` (for example, an `nvm`-managed `node` binary or `/usr/bin/cargo` on some Linux systems).

---

## Data Model Quick Reference (SQLite)

| Table | Scope | Notes |
|---|---|---|
| `workspaces` | top-level | multi-workspace support |
| `projects` | workspace | chat containers only |
| `notes` | workspace | daily notes + freeform |
| `note_templates` | workspace | Markdown templates |
| `chat_sessions` | project | single chat thread |
| `chat_messages` | session | role: user / assistant |
| `documents` | workspace | uploaded files |
| `document_chunks` | document | chunked text for RAG |
| `web_captures` | workspace | saved web pages |
| `concept_nodes` | workspace | knowledge graph nodes |
| `concept_links` | — | directed edges between nodes |
| `note_links` | — | `[[wiki-link]]` backlink index |
| `flashcards` | workspace | SM-2 spaced repetition |
| `learning_goals` | project | milestone tracking |
| `settings` | global | key-value store |
| `alarms` | global | scheduled reminders |

---

## Adding a New Feature — Checklist

1. **Schema**: add `CREATE TABLE IF NOT EXISTS` or new columns in `schema.sql`.
2. **Rust model**: add a struct in `src-tauri/src/models/` with `Serialize`/`Deserialize`.
3. **Rust command(s)**: add `pub fn command_name(state: State<DbState>, ...) -> Result<T, String>` in the appropriate `commands/*.rs` file, then register in `lib.rs`.
4. **`api.ts`**: add a typed `invoke<T>('command_name', { ... })` wrapper.
5. **View**: create `src/views/FeatureView.tsx`, add a route in `App.tsx`, add a sidebar entry if needed.
6. **Verify**: `cargo check` → exit 0, `tsc --noEmit` → exit 0.

---

## Git Conventions

- Branch: `develop` is the integration branch. Feature work goes on short-lived branches off `develop`.
- Commits: use [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `refactor:`, `chore:`, etc.
- Do **not** add "Co-authored-by: Claude" or similar AI attribution to commits.
- Do **not** force-push to `develop` or `main`.

---

## Testing

- Swift tests: `Tests/AetheriumTests/`. Run with `swift test`.
- Tauri frontend tests live in `tauri/src/tests/` and run with `npx vitest run` (or the equivalent absolute `node` path if `npx` is not on `PATH`).
- For Tauri work, manual verification is still important, but `vitest` + `cargo check` + `tsc --noEmit` are the standard gates.
- When fixing a bug, add or update a Swift test covering the regression if the affected code is in the Swift app.
- When fixing a Tauri bug, add or update a focused `vitest` regression test when the behavior is practical to cover in `src/tests/`.
- For split-pane Tauri bugs, prefer a regression test that exercises both single-pane and split-pane flows, especially split-toggle behavior, pane-scoped session loading, and stale project-filter cleanup.

---

## Safety Protocols

### Data & Context Preservation
- **Never `git checkout .` or `git restore .` without a full `git diff` first.** You may accidentally discard uncommitted changes that were necessary for the current task or environment state.
- **Assume uncommitted changes are intentional.** If you see modifications you don't recognize, ask the user or analyze them thoroughly before reverting.

### Database Migrations
- **Always list explicit column names in `INSERT` and `SELECT` statements.** Never use `SELECT *` or positional inserts without column names. This prevents migrations from failing when `schema.sql` evolves (e.g., adding a column to the base schema will cause `SELECT *` in an old migration to return an unexpected number of columns).
- **Keep migrations idempotent.** Ensure they can run safely even if the target state (e.g., a new column) already exists in the table.
- **Maintain Foreign Keys.** When restructuring tables in migrations, ensure all `REFERENCES` and `ON DELETE` constraints are preserved in the new table definition.

## Debugging Runtime Bugs

## What to Avoid

- Do **not** add `@tailwind` directives outside `src/styles/`.
- Do **not** call `unwrap()` or `expect()` in Rust command handlers — propagate errors with `?` or map them to `String`.
- Do **not** store secrets or API keys in source files. Use the `settings` table or environment variables.
- Do **not** create new markdown documentation files unless explicitly asked.
- Do **not** refactor or "clean up" code outside the scope of the current task.
