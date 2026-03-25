# Aetherium — Tauri Roadmap & To-Do

Scope: `todo.md` tracks the Tauri app only. Swift/macOS work may differ and is not reflected here unless explicitly noted.

Legend: ✅ Complete · 🔄 Partial · ⬜ Not started

---
## 🚨 Imminent Changes (Priority 0)

### 1. ⬜ UI & Navigation Refinements
- [ ] **Project Tab Overflow** — Define UX for when project tabs exceed window width (e.g. cap at two rows or implement horizontal scroll).
- [ ] **Chat Management** — Add ability to multi-select chats for batch actions, and introduce a "Star" / favorite toggle to pin important sessions.
- [ ] **Project Scratchpad** — Add a dedicated, quick-access scratchpad pane for each project directly within the chat view for temporary notes.

### 2. ⬜ Feature Consolidation
- [ ] **Chat & Thought Queue Merger** — Integrate the "Thought Queue" functionality directly into the Chat architecture rather than having it as a standalone view.
- [ ] **Graph & Flashcard Unification** — Explore merging the Knowledge Graph and Flashcards interfaces. Navigating the graph could organically transition into reviewing spaced-repetition cards for those concepts.
- [ ] **Unified 'Source' Concept** — Combine "Documents" and "Web Captures" into a single, unified data model to simplify the ingestion pipeline and UI.
- [ ] **Frictionless Flashcards** — Overhaul flashcard creation to be completely auto-generated seamlessly from chat/notes, or reduced to a single-click action.

### 3. ⬜ Security — PIN Recovery
- [ ] **Forgotten PIN** — There is currently no recovery path if a user forgets their PIN; they are fully locked out. Add a recovery flow (options: emergency data-wipe with explicit warning, or a one-time recovery phrase generated at PIN-setup time). Defer until the security layer is more settled — avoid touching encryption/deletion during rapid iteration.

### 4. ⬜ Data Lifecycle & Migrations
- [ ] **Cascading Deletes & Workspace Moves** — Define exact behavior when deleting a workspace or project. Implement the ability to move a project to another workspace. Determine the exact cascading rules for owned entities: do chats, concepts, notes, flashcards, learning goals, daily notes, and templates move with the project or stay behind?

## 🎬 Demo Mode — Plan

## 🎬 Demo Mode (Remaining Work)
The goal is a zero-setup "Try Demo" experience: a new user launches the app, taps one button, and immediately sees a fully-populated, interactive Aetherium environment — no Ollama required, no real data at risk.

### Guiding principles
- **Isolation** — demo data lives in a separate, in-memory SwiftData container; it can never contaminate the user's real store.
- **No Ollama dependency** — all AI responses are pre-scripted; the demo works on a fresh Mac with no local models installed.
- **Read-friendly, not read-only** — users can click, edit, and explore freely. Destructive actions (delete project, wipe all data) show a friendly "reset demo" prompt instead of doing real damage.
- **One-tap entry & exit** — "Try Demo" button on the auth screen; "Exit Demo" button always visible inside the app.

bugs
inferred topics cannot be removed
---

- [ ] Add "Try Demo" button on initial screen
- [ ] Show demo banner in Layout when active
- [ ] Guard destructive actions with a modal when in demo mode
- [ ] Add scripted AI responses (`MockOllamaService` equivalent) so demo chat works without Ollama
- [ ] Add onboarding tooltips & 'What can I try?' help sheet

### Demo scenario content

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

## 🏁 Polish & Production-Ready
- [ ] **Progress Indicators**: Show a spinner/progress bar during embedding generation, document imports, and graph rebuilds so the UI doesn't feel frozen.

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

