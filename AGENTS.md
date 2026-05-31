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
*   **Rust/Backend:** Run `cargo check --manifest-path src-tauri/Cargo.toml` after backend changes. For lint correctness, also run `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`; clippy warnings are treated as errors.
*   **Logic/UI:** Run only the relevant test file (e.g., `npx vitest run src/tests/views/ChatView.test.tsx`) to ensure no existing functionality was broken.

**Cadence — when to run which check.** Match the check to the edit. Don't run `./lint.sh` after every change — it's multi-minute and will tank throughput — but don't defer all checks to commit time either, which is the worst spot to discover problems.

*Run the targeted check immediately for these "major" edits:*

*   Interface / signature changes (Rust struct fields, `fn` signatures, new `#[tauri::command]`, exported TS interface or type, React component prop shape).
*   New files or new exported symbols (new `.rs` / `.tsx` / `.ts` file, or adding a new exported symbol to an existing one).
*   Schema / migration / IPC plumbing (any edit to `schema.sql`, any new migration, any change to `tauri::generate_handler![…]`, any new `invoke()` wrapper in `src/lib/api.ts`).
*   Any task that touches 3+ files in one go — cross-file blast radius makes drift likely.

The targeted check is the cheap one matched to the edit: `cargo check --manifest-path src-tauri/Cargo.toml` for Rust, `npx tsc --noEmit` for TS, the single affected `npx vitest run path/to/file.test.tsx` for a component or hook with an existing test. Not `./lint.sh`.

*Run a checkpoint before pausing to talk to the user.* Whenever you are about to stop and ask the user a question, report progress, or hand back control, first run the targeted checks for whatever languages you've touched since the last checkpoint. The goal: every message you send the user carries a known-good (or known-bad) state. The user should never learn about a lint error or failing test as fresh news when they ask you to commit — by then, you've either already fixed it, or you've already told them about it.

*Trivial edits* (comments, log strings, internal renames with no exported surface) don't need an immediate check. They ride to the next checkpoint.

*At commit time only:* `./lint.sh` (full `tsc`, full `vitest`, `cargo clippy -D warnings`, SwiftLint, ESLint). If `./lint.sh` catches something at this point, the cadence rule above wasn't followed — fix the cadence next time.

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

### 6. Tauri Command Registration
A new `#[tauri::command]` is not callable until it is listed in `tauri::generate_handler![…]` in `src-tauri/src/lib.rs`. `cargo check` will pass without it — the failure only surfaces at runtime as `"Command <name> not found"` returned to the JS caller.

When adding or renaming a command:
1. Add the `pub (async) fn` in `src-tauri/src/commands/<domain>.rs`.
2. Add the matching `invoke<T>("<name>", …)` wrapper in `src/lib/api.ts`.
3. Add the command to `tauri::generate_handler![…]` in `src-tauri/src/lib.rs`.
4. Verify all three names match exactly: Rust fn name == handler entry == string in `invoke()`.

If a feature ships steps 1 + 2 but skips step 3, the UI will appear to hang on its loading state because the IPC rejects immediately and the view never leaves its `if (!data) return <Loading/>` branch. Before considering an IPC feature done, open DevTools and confirm at least one successful `[ipc] <- <command>` log line for the new command — not just that the code compiles.

---

## Project Overview

**Aetherium** is a local-first AI learning companion. It exists as two parallel implementations:

| Codebase | Language / Framework | Entry point |
|---|---|---|
| **Swift / macOS** | Swift 5.9 + SwiftUI + SwiftData | `swift/Sources/Aetherium/` |
| **Tauri / cross-platform** | Rust (Tauri v2) + React + TypeScript | `tauri/` |

Both apps share the same feature set and data model; the Tauri port is the active development target.

### Technology Stack
- **Backend:** Rust, Tauri v2, SQLite (rusqlite), Ollama (local AI), reqwest, serde.
- **Frontend:** React 18, TypeScript (strict), Tailwind CSS v3, Zustand (state management), Vite.
- **Native macOS:** Swift 5.9, SwiftUI, SwiftData, LocalAuthentication.

---

## Repository Layout

```
tbj0103/
├── swift/Sources/Aetherium/    # Swift app (macOS)
│   ├── Models/                 # SwiftData models
│   ├── Views/                  # SwiftUI views
│   ├── Services/               # Business logic
│   ├── Demo/                   # Demo mode infrastructure
│   ├── Managers/               # App-wide managers (theme, shortcuts)
│   └── Plugins/                # Plugin system
├── swift/Tests/AetheriumTests/ # Swift tests (XCTest)
├── tauri/                      # Tauri cross-platform app
│   ├── src/                    # React + TypeScript frontend
│   │   ├── views/              # Page-level components
│   │   ├── components/         # Shared UI components
│   │   ├── lib/api.ts          # All Tauri invoke() calls
│   │   ├── stores/             # Zustand stores
│   │   └── styles/             # Tailwind CSS
│   └── src-tauri/              # Rust backend
│       ├── src/commands/       # Tauri command handlers (thin wrappers)
│       ├── src/services/       # Core business logic (RAG, search, linking, etc.)
│       ├── src/models/         # Rust structs and database models
│       ├── src/db/             # SQLite connection pool
│       ├── src/ollama/         # Ollama HTTP client
│       └── schema.sql          # SQLite schema (source of truth)
├── docs/                       # Project documentation
│   ├── ARCHITECTURE.md         # Deep dive into system design
│   ├── todo.md                 # Active roadmap — read before starting work
│   └── bugs.md                 # Known issues — check before touching affected areas
├── README.md
├── AGENTS.md
├── GEMINI.md
└── lint.sh
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
- **A store field is not a feature until something reads it.** When adding new state to a Zustand store, verify at least one production component subscribes to that field via `useWorkspaceStore((s) => s.field)` (or equivalent). Tests that mount the field's setter or assert on the raw store value do **not** count as readers. Before considering a store field "done," `grep -r "s\.fieldName\|state\.fieldName" src/` should return at least one hit outside `stores/`, `tests/`, and the field's own settings UI. A diff that ships types + setter + persistence + tests but no reader is a feature stuck in the store — invisible during code review, and the bug is silent until a user reports the missing behavior.

#### Pane-scoped vs window-scoped navigation chrome

When adding navigation chrome (workspace switcher, section nav, command bars), decide explicitly whether it is **window-scoped** (rendered once in `Layout.tsx`) or **pane-scoped** (rendered inside `WorkspacePaneChrome` per pane in `SplitPaneLayout.tsx`).

- Window-scoped chrome must read from `useWorkspaceStore` directly.
- Pane-scoped chrome must read from `useScopedWorkspace` / `useScopedChat` / `useScopedProjects`.
- Layout presentation choices (sidebar / tabs / dropdown) may legitimately switch a single piece of chrome between these scopes. For example, a `sidebar` choice typically lives per-pane while a `top-tabs` choice typically lives in the shared titlebar.
- When that scope switch happens, **both `Layout.tsx` and `SplitPaneLayout.tsx` must update together**: gate the window-scoped renderer off when the pane-scoped variant is active, and add the pane-scoped variant inside the pane chrome. Failing to do both produces either double-rendering (chrome in titlebar AND in pane) or an empty region (gated off in titlebar but never added to the pane).

### Backend (Rust / Tauri)

- **SQLite is the single source of truth.** The schema lives in `src-tauri/src/schema.sql`. All migrations are additive `CREATE TABLE IF NOT EXISTS` statements; never drop or alter existing columns.
- Tauri commands go in `src-tauri/src/commands/`, one file per domain (note, chat, search, etc.). Register new commands in `src-tauri/src/lib.rs` inside the `.invoke_handler(tauri::generate_handler![...])` call.
- Services (`src-tauri/src/services/`) contain business logic that commands delegate to. Commands should be thin — validate input, acquire the DB lock, call a service, return the result.
- Use `rusqlite` through the app’s `r2d2_sqlite` connection pool (`DbState`). Acquire a connection with `state.0.get().map_err(|e| e.to_string())?`.
- All command return types must be `Result<T, String>` where the error string is a human-readable message.
- **Avoid N+1 queries.** Never fetch per-row data inside a loop (e.g., querying tags or counts for each session individually). Use a single query with `JOIN`, `GROUP BY`, or `UNION ALL` instead. Past incidents: chat session list, dashboard stats, context assembler.
- **Tauri commands must not block the async runtime.** Any command that does file I/O, HTTP, or heavy computation must be `async` and use `tokio::task::spawn_blocking` for synchronous work. Blocking a command handler starves other IPC calls.
- Run `cargo check` to verify — it must exit 0 before committing.

### Window Management (Linux)

- On Linux, `data-tauri-drag-region` alone is unreliable for window dragging. Every drag-region element must **also** attach the `onDragRegionMouseDown` handler exported from `src/components/WindowControls.tsx`, which calls `getCurrentWindow().startDragging()` programmatically.
- The `WindowControls` component renders minimize / maximize / close buttons **only on Linux** (macOS uses native traffic lights). It uses an explicit `isMaximized()` check to toggle maximize/unmaximize — do **not** use `toggleMaximize()`.
- Any new top-level view or screen that renders a drag region (e.g., a loading/splash screen) must import and apply `onDragRegionMouseDown`.
- **Debounce window state persistence on Linux.** Writing window position/size/maximize state on every event causes malloc corruption. Any listener that persists window state must debounce writes (e.g., 300 ms). Do not write on every `resize` or `move` tick.

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

# Rust lint (clippy)
cargo clippy --manifest-path tauri/src-tauri/Cargo.toml -- -D warnings

# Run all checks at once (SwiftLint + ESLint + tsc + clippy)
# All four checks must exit 0 — treat any non-zero exit (including lint warnings under -D warnings) as a blocker.
./lint.sh

# Run dev server (requires Ollama running on :11434 for AI features)
cd tauri
npm install          # run on first checkout or after package.json changes
npm run tauri dev
```

> **Node / nvm (non-interactive shells):** The project pins Node 22 via `.nvmrc`. nvm shims (`node`, `npm`, `npx`) only activate in interactive shells, so they may silently fail in Claude Code. If `npx` is not found, resolve the right binary with: `ls ~/.nvm/versions/node/ | sort -V | tail -1` to find the latest installed version, then call `~/.nvm/versions/node/<version>/bin/npx` directly. Do not hardcode a version — it varies by machine.

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

### Commit Scope Hygiene

**Stage by filename, not by directory.** When committing, only stage files you intentionally edited in the current task.

- Run `git diff --stat` before `git add` and confirm each file is in scope for the task you set out to do.
- If you see modified files you don't recognize, they likely belong to in-progress work from a prior session. Leave them unstaged rather than bundling them into an unrelated commit — mixing scopes makes `git blame` and `git bisect` actively misleading later.
- `git add -A` and `git add .` are discouraged for the same reason. Prefer `git add <path1> <path2> ...` with explicit filenames so the staging decision is visible in your output.
- The exception is when the user explicitly asks for "everything" — in that case echo back the file list before committing so the scope is logged.

### Commit Message Quality

**Problem:** Large commits (20+ files, 1000+ lines) with vague titles hide actual scope and make history hard to understand.
**Examples of incomplete messages:**
- "add quick search workflow and related app updates" (hides FTS indexing, keyboard shortcuts, schema changes)
- "improve local inference preferences and chat workflow" (hides hardware detection, model sizing, system specs)
- "remove plugin preferences entry" (hides IPC observability, SQL standardization, backup refactor, theme normalization)

**Standard format:**
```
feat: [concise title describing main change]

[1-2 sentence summary of why this matters]

System/Area 1:
- Technical detail
- Technical detail

System/Area 2:
- Technical detail
- Technical detail
```

**Guidelines:**
- **Title (first line):** Concise, under 70 chars. Describe what changed, not what was attempted.
- **Body:** Organize by system/feature. Use bullet points for implementation details.
- **Scope:** For multi-feature commits (20+ files), document ALL features, not just the primary one.
- **Avoid:** "updates", "improvements", "fixes" without context. Vague titles force future readers to examine diffs.
- **When in doubt:** If `git diff --stat` shows changes across 10+ files, your commit message should reflect that breadth.

**Why this matters:** Future developers (or future-you) need to understand commits without reading code. Incomplete messages block understanding and make blame/bisect harder.

---

## Testing

- Swift tests: `swift/Tests/AetheriumTests/`. Run with `cd swift && swift test`.
- Tauri frontend tests live in `tauri/src/tests/` and run with `npx vitest run` (or the equivalent absolute `node` path if `npx` is not on `PATH`).
- For Tauri work, manual verification is still important, but `vitest` + `cargo check` + `tsc --noEmit` are the standard gates.
- When fixing a bug, add or update a Swift test covering the regression if the affected code is in the Swift app.
- When fixing a Tauri bug, add or update a focused `vitest` regression test when the behavior is practical to cover in `src/tests/`.
- For split-pane Tauri bugs, prefer a regression test that exercises both single-pane and split-pane flows, especially split-toggle behavior, pane-scoped session loading, and stale project-filter cleanup.
- **Audit test mock defaults when changing render logic.** If a render-time function previously collapsed multiple input values into one output (e.g., mapping `sidebar` → `tabs` in split mode), tests written against the old behavior may have inherited a default mock value that exercises the collapsed branch instead of the branch they appear to test. When refactoring such a function, grep test files for `setState` defaults and confirm each test's setup matches the branch its assertions target — especially for shared default mocks at the top of the file. A test that passes both before and after the change may have been testing the wrong path the whole time.

---

### Safety Protocols

#### No Data Leaks (Local-First Principle)
- **Zero Telemetry:** Never add telemetry, external logging, or analytics that bypasses the local-first principle. All data must remain on the user's machine.

#### Ollama Prerequisite
- AI features (chat, topic signatures, RAG) require Ollama running on `http://localhost:11434`. Before investigating AI-related failures, verify with `curl http://localhost:11434/api/tags`. A 7B+ model must be pulled for most features to produce meaningful output (`ollama list`).

### Data & Context Preservation
- **Never `git checkout .` or `git restore .` without a full `git diff` first.** You may accidentally discard uncommitted changes that were necessary for the current task or environment state.
- **Assume uncommitted changes are intentional.** If you see modifications you don't recognize, ask the user or analyze them thoroughly before reverting.

### Database Migrations
- **Always list explicit column names in `INSERT` and `SELECT` statements.** Never use `SELECT *` or positional inserts without column names. This prevents migrations from failing when `schema.sql` evolves (e.g., adding a column to the base schema will cause `SELECT *` in an old migration to return an unexpected number of columns).
- **Keep migrations idempotent.** Ensure they can run safely even if the target state (e.g., a new column) already exists in the table.
- **Maintain Foreign Keys.** When restructuring tables in migrations, ensure all `REFERENCES` and `ON DELETE` constraints are preserved in the new table definition.

## Debugging Runtime Bugs

- **Tauri IPC errors:** Open DevTools (`Ctrl+Shift+I`) and check the Console for `invoke` rejections. The error string is what the Rust command returned as `Err(String)`.
- **Rust panics (dev):** Check the terminal running `npm run tauri dev`. Release builds suppress panics; dev builds print the full location.
- **UI state bugs:** Install the Redux DevTools browser extension — it works with Zustand and lets you inspect the full store state over time.
- **Ollama-related failures:** Confirm Ollama is running (`curl http://localhost:11434/api/tags`) and the expected model is pulled (`ollama list`). Many "no response" bugs are missing models, not code bugs.
- **Render loop / infinite update:** Add a temporary `console.trace()` inside the looping effect to identify the exact call site. Then audit the dependency array for unstable function references (see React / Zustand Effect Safety above).
- **Split-pane state divergence:** Log `useScopedWorkspace()` output for both panes. State drift almost always traces to a global store write (e.g., `setActiveWorkspaceId`) being called from a pane-scoped component instead of `setPaneWorkspace`.
- **SQLite errors:** SQLite errors surface as `Err(String)` from commands. Look for `UNIQUE constraint failed`, `FOREIGN KEY constraint failed`, or `no such column` — each points to a specific schema/query mismatch.

## What to Avoid

- Do **not** add `@tailwind` directives outside `src/styles/`.
- Do **not** call `unwrap()` or `expect()` in Rust command handlers — propagate errors with `?` or map them to `String`.
- Do **not** store secrets or API keys in source files. Use the `settings` table or environment variables.
- Do **not** create new markdown documentation files unless explicitly asked.
- Do **not** refactor or "clean up" code outside the scope of the current task.
** create new markdown documentation files unless explicitly asked.
- Do **not** refactor or "clean up" code outside the scope of the current task.
