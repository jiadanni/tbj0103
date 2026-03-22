# Aetherium — Tauri Roadmap & To-Do

Scope: `todo.md` tracks the Tauri app only. Swift/macOS work may differ and is not reflected here unless explicitly noted.

Legend: ✅ Complete · 🔄 Partial · ⬜ Not started

---

## 🎬 Demo Mode — Plan

The goal is a zero-setup "Try Demo" experience: a new user launches the app, taps one button, and immediately sees a fully-populated, interactive Aetherium environment — no Ollama required, no real data at risk.

### Guiding principles
- **Isolation** — demo data lives in a separate, in-memory SwiftData container; it can never contaminate the user's real store.
- **No Ollama dependency** — all AI responses are pre-scripted; the demo works on a fresh Mac with no local models installed.
- **Read-friendly, not read-only** — users can click, edit, and explore freely. Destructive actions (delete project, wipe all data) show a friendly "reset demo" prompt instead of doing real damage.
- **One-tap entry & exit** — "Try Demo" button on the auth screen; "Exit Demo" button always visible inside the app.

---

### Phase 1 — Demo infrastructure (no UI changes yet)

#### 1a. ✅ `DemoDataService`
A pure Swift struct (no `@Observable`, no SwiftData dependency) that builds a deterministic, fully-linked object graph and inserts it into a given `ModelContext`.

Objects to seed:
- **3 projects** (see "Demo scenario" below)
- **~20 concept nodes** spread across those projects, with typed links (`Related`, `Prerequisite`, `Supports`, `Contradicts`)
- **2–3 chat sessions per project**, each with 6–10 message turns (user + assistant), some with citations pointing at seeded sources
- **2–3 sources per project** — one `ProjectNote` (inline markdown), one `UploadedDocument` stub (no real file, just extracted text + a few `DocumentChunk` rows), one `WebCapture`
- **3 learning goals per project** with varying `progress` values (0 %, 45 %, 100 %) and prerequisite links between them
- **A learning path** with 4 milestones, two completed
- **~15 flashcard (`LearningCard`) rows** across projects with realistic `easinessFactor`, `interval`, and `nextReviewDate` values so the spaced-repetition deck is non-trivial
- **7 `DailyNote` rows** for the past week so the activity heatmap shows real data
- **2 `NoteTemplate` rows** showing custom templates the user supposedly created

Dates: all seeded objects use relative offsets from `Date()` so the heatmap, streaks, and "last edited" labels feel current on any launch day.

#### 1b. ✅ `DemoModeManager`
A lightweight `ObservableObject` that owns two things:
```
var isActive: Bool
var demoContainer: ModelContainer   // .inMemory configuration
```
On `activate()`:
1. Create the in-memory `ModelContainer` with all 18 model types.
2. Call `DemoDataService.seed(into: context)`.
3. Set `isActive = true`.

On `deactivate()`:
1. Set `isActive = false`.
2. Drop the in-memory container (ARC takes care of cleanup — nothing persists).

#### 1c. ✅ `MockOllamaService` / scripted responses
Extend `OllamaService` with a `demoResponseProvider: ((String) -> String)?` closure. When set, `sendMessage` returns the scripted string via `AsyncThrowingStream` character-by-character (simulating streaming) instead of hitting any URL. This lets the chat view animate in a response naturally without Ollama running.

Pre-write ~10 realistic Q&A pairs covering the seeded content (e.g. "What is attention in transformers?" → a plausible 3-paragraph answer with a citation to the seeded paper source).

---

### Phase 2 — Entry & exit UI

#### 2a. ✅ "Try Demo" button on `AuthenticationView`
Below the "Unlock Aetherium" button, add a secondary `Button("Try Demo — no account needed")` that calls `DemoModeManager.shared.activate()` and sets `securityManager.isAuthenticated = true` (or adds a dedicated `isDemoActive` bypass in the authentication check).

#### 2b. ✅ Demo banner inside the app
When `DemoModeManager.isActive`, show a thin persistent banner at the top of `ContentView`:
```
⚡ Demo Mode  — changes are temporary  [Exit Demo]
```
Tapping "Exit Demo" calls `deactivate()`, clears `isAuthenticated`, and returns to the auth screen. The real user store is untouched.

#### 2c. ✅ Guard destructive actions in demo mode
In any view that permanently deletes a project, note, or session, check `DemoModeManager.shared.isActive` and redirect to a sheet:
```
"You're in Demo Mode. Want to reset the demo to its original state, or exit and start fresh?"
[Reset Demo]  [Exit Demo]  [Cancel]
```

---

### Phase 3 — Demo scenario content

Three projects that together show off every major feature:

| # | Project title | Theme | Features highlighted |
|---|---|---|---|
| 1 | **"Understanding Transformers"** | ML paper deep-dive | RAG chat with citations, 20-node knowledge graph, flashcard deck, learning path with milestones |
| 2 | **"Building a SaaS Product"** | Startup / product notes | Daily notes, meeting note templates, backlinks, concept clustering |
| 3 | **"History of the Roman Empire"** | Humanities research | Timeline-style daily notes, person-type concept nodes, Obsidian-style backlinks, spaced repetition deck |

Each project's chat sessions should demonstrate a different capability:
- Session with source citations (RAG)
- Session showing a branched conversation (`branchLabel` set)
- Session starting from a template ("Learning Session" template)

---

### Phase 4 — Polish & discoverability

#### 4a. ✅ Onboarding tooltips in demo mode
When `isActive`, overlay callout bubbles on first render:
- Knowledge Graph view: "Tap any node to see connections"
- Chat view: "Ask a question about your sources"
- Flashcard view: "Press Space to reveal the answer"

#### 4b. ✅ "What can I try?" floating help button
A `?` button (bottom-right corner, demo mode only) opens a sheet listing 5–6 suggested actions: "Ask a question in Chat", "Flip a flashcard", "Explore the knowledge graph", etc. Each action is a deep-link that navigates the user into the right view.

#### 4c. ✅ Demo reset without exit
Allow resetting demo state (re-seed) without leaving demo mode. Useful for sales demos where you want to restore a pristine state between showings.

---

### Implementation order (recommended)

1. `DemoDataService` with seed data → validates the data model compiles cleanly
2. `DemoModeManager` + in-memory container wiring → test by printing seeded object counts
3. `MockOllamaService` scripted responses
4. Auth screen "Try Demo" button + `ContentView` banner
5. Guard destructive actions
6. Onboarding tooltips & help sheet

---

## 🏁 Polish & Production-Ready

### 1. ✅ Testing & Quality Assurance
- [x] Unit tests for OllamaService, DocumentProcessor, SpacedRepetitionEngine
- [x] Integration tests for RAG pipeline
- [x] UI tests for critical workflows
- [x] Mock Ollama responses for testing (MockURLProtocol)

### 2. ✅ Error Handling & Resilience
- [x] Better error messages with user-friendly explanations
- [x] Retry logic for Ollama API failures (exponential back-off)
- [x] Offline mode detection (`isOfflineMode` in OllamaService)
- [x] Graceful degradation when Ollama is unavailable (ModelOrchestrator)
- [ ] Progress indicators for long-running operations — show a spinner/progress bar during embedding generation, document imports, and graph rebuilds so the UI doesn't feel frozen

### 3. ✅ Performance Optimization
- [x] Profile embedding generation & batch processing — instead of sending one chunk at a time to Ollama, send multiple in parallel to reduce total import time
- [x] Optimize knowledge graph rendering for large datasets — the graph view can get slow with hundreds of nodes; switch to level-of-detail rendering or cluster small nodes
- [x] Lazy loading for document chunks — only load chunk text from disk when it's actually needed for a query, not on app launch
- [x] Background processing for imports — run document parsing and embedding on a background thread so the UI stays responsive
- [x] Cache frequently accessed data — store recent embedding results and query results in memory so repeated searches don't re-hit Ollama

---

## 🎯 High-Impact Features

### 4. ⬜ Themes & Customization
- [ ] Light/dark mode toggle — let users override the system appearance preference
- [ ] Custom color schemes — accent colours for the graph nodes, sidebar, and highlights
- [ ] Font size preferences — global text size slider, important for readability in the editor
- [ ] Configurable keyboard shortcuts — let users remap common actions (new note, search, toggle sidebar)
- [ ] Layout customization — adjustable sidebar width, collapsible panels

### 5. ⬜ Advanced Graph Algorithms
- [ ] PageRank for concept importance — borrowed from how Google ranks web pages; nodes that are linked to by many other nodes bubble up as "most important" concepts in your knowledge base
- [ ] Community detection for topic clustering — automatically groups tightly-connected concepts into named clusters (e.g. "Machine Learning", "History"), like finding neighbourhoods on a map
- [ ] Shortest path between concepts — given two unrelated-looking notes, find the chain of links that connects them; useful for discovering unexpected relationships
- [ ] Graph metrics (centrality, degree distribution) — centrality = how many links point to a node (high centrality = a hub concept); degree distribution = a chart showing how evenly or unevenly your knowledge is connected
- [ ] Time-based evolution — a slider or animation showing how your graph grew over time, note by note

### 6. ⬜ Plugin Developer Experience
- [ ] Plugin SDK with documentation — a clearly defined Swift API + README so third parties can build importers/exporters without reading the internals
- [ ] Example plugin template — a minimal starter project with boilerplate already filled in
- [ ] Plugin testing framework — helpers to write unit tests for plugins without needing a full app instance

---

## 🔌 Expand Ecosystem

### 7. 🔄 More Built-in Plugins
- [x] Markdown Exporter
- [x] Obsidian Exporter
- [x] YouTube Importer
- [x] Anki Exporter
- [ ] Kindle Highlights Importer — reads Amazon's `My Clippings.txt` file (saved to device when you highlight on a Kindle) and turns each highlight + book into a note  ← **priority**
- [ ] Pocket / Instapaper Importer — pull in your saved read-later articles so they become searchable knowledge
- [ ] RSS Feed Reader — subscribe to feeds and automatically ingest new articles as notes
- [ ] Goodreads Integration — import your read/currently-reading shelf and book notes
- [ ] Logseq / Roam Importer — parse the JSON/EDN export formats those apps produce and convert them into Aetherium notes, preserving backlinks
- [ ] Mind Map Visualization — a radial/tree layout alternative to the force-directed graph, better for exploring a single concept and its children  ← **priority**
- [ ] Timeline View — arrange notes chronologically on a horizontal timeline; useful for history, research, or project journals

### 8. 🔄 Enhanced Export / Import
- [x] HTML export (used internally for PDF generation)
- [ ] Standalone interactive HTML export — a self-contained `.html` file with the knowledge graph embedded and clickable, shareable without needing Aetherium installed  ← **priority**
- [ ] LaTeX export — format notes as a `.tex` document suitable for academic papers, with citations and proper sectioning
- [ ] Notion import/export — use Notion's API to push/pull pages; handy for teams that mix Notion and Aetherium
- [ ] Roam Research JSON import — convert Roam's `roam-export.json` block structure into flat Aetherium notes
- [ ] Batch export — export all projects at once rather than one at a time
- [ ] Export templates — let users define a Mustache/Handlebars-style template that controls how notes are formatted on export

---

## 🚀 Advanced Features

### 9. 🔄 AI Enhancements
- [x] Multi-model support — choose a different Ollama model per project or per chat session (e.g. a fast small model for drafts, a large model for deep analysis)
- [x] Model comparison — send the same prompt to two models side-by-side and compare their answers; useful for evaluating which model works best for your content
- [x] Custom system prompts per project — each project and chat can have its own "you are an expert in X" preamble prepended to every chat
- [ ] Semantic deduplication — scan notes for ones that are semantically very similar (even if worded differently) and surface them so you can merge or consolidate
- [ ] Auto-summarization on document upload — when a PDF or long article is imported, immediately generate a TL;DR note alongside the raw chunks

### 10. ⬜ Collaboration & Sync (Long-term)
- [ ] Git-based sync — store the project as plain files in a git repo; push/pull to sync across machines without a custom server
- [ ] Conflict resolution UI — if two machines edited the same note offline, show a diff and let the user pick which version to keep
- [ ] Shared projects with permissions — invite collaborators with read-only or read-write access
- [ ] iCloud sync — use CloudKit or iCloud Drive so notes sync automatically across your Apple devices

---

## 💭 Someday / Maybe
These are lower-priority or higher-complexity ideas. Revisit when there's clear demand.

- **Pomodoro Timer with note linking** — scope creep; a time-boxing timer that auto-links to the note you were working on. Better served by a dedicated app.
- **Fine-tuning interface** — prepare training data (prompt/completion pairs) from your notes to fine-tune a local LLM. Very heavy lift; needs its own backend pipeline.
- **Hot-reloading for plugins** — reload a plugin without restarting Aetherium during development. Complex in Swift; only worthwhile if there's an active external plugin community.
- **Plugin store backend** — a hosted catalog where users can browse and install community plugins. Requires server infrastructure; premature until external plugin authors exist.
- **Model comparison (extended)** — a/b testing across more than two models with scoring. Interesting research tool but niche for most users.

---

## 📊 Priority Order (Next Steps)

1. **Progress indicators** — finish off Error Handling (#2)
2. **Themes & Customization** (#4) — big UX win
3. **Kindle Highlights + Mind Map + Interactive HTML export** (#7, #8) — immediate user value
4. **Advanced Graph Algorithms** (#5) — unlocks powerful insights
5. **Plugin SDK & Documentation** (#6) — enables community contributions
6. **Performance Optimization** (#3) — profile first, then optimise
7. **AI Enhancements** (#9)
8. **Collaboration & Sync** (#10) — long-term

---

## 🧊 On Ice — GlassCode-Inspired

These features were evaluated from the GlassCode UI study but deferred. Revisit when the core composer bar and dashboard are stable.

- **Skills Marketplace UI** — Browsable skill/plugin cards with icons, descriptions, and toggle switches layered on top of the existing MCP server system. Requires a plugin registry backend or curated card list.
- **Inline Diff / File Change Cards in Chat** — When an AI tool call (via MCP) performs a file operation, show inline diff cards with `+N / -N` counts and a Review button alongside the chat message. Requires streaming MCP tool result events into the message renderer.
