# Aetherium — Tauri Roadmap & To-Do

Scope: `todo.md` tracks the Tauri app only. Swift/macOS work may differ and is not reflected here unless explicitly noted.

Legend: [x] Complete · [/] Partial · [ ] Not started

---

## Imminent (Priority 0)

### 1. 🔄 UI & Navigation Refinements
- [ ] **Project Scratchpad** — Add a dedicated quick-access scratchpad pane per project within the chat view.

### 2. 🔄 Feature Consolidation
- [ ] **Chat & Thought Queue Merger** — ThoughtQueueView still exists as a standalone view; integrate into the Chat architecture. (Note: thought queue is already accessible from ChatView via inline panel, but the standalone view remains.)
- [ ] **Graph & Flashcard Unification** — Merge Knowledge Graph and Flashcards interfaces so navigating the graph transitions into reviewing spaced-repetition cards.
- [ ] **Unified 'Source' Concept** — Documents and Web Captures are still separate views/models. Combine into a single ingestion model.

### 3. ⬜ Security — PIN Recovery
- [ ] **Forgotten PIN** — No recovery path exists. Add a recovery flow (emergency data-wipe with warning, or one-time recovery phrase at PIN-setup time). Defer until security layer stabilizes.

### 4. 🔄 Data Lifecycle & Migrations
- [ ] **Move projects between workspaces** — not yet implemented.
- [ ] **Entity ownership rules** — define exact behavior for chats, concepts, notes, flashcards, learning goals, daily notes, and templates when a project moves.

---

## Demo Mode (Remaining Work)

Backend infrastructure exists (`activate_demo_mode` / `deactivate_demo_mode` commands seed 3 demo projects under a special workspace). Frontend wiring is partial — `workspaceStore` has `isDemoMode` and `setDemo`.

### Still needed
- [ ] Add "Try Demo" button on the AuthenticationView / initial screen
- [ ] Show demo banner in Layout when `isDemoMode` is active
- [ ] Guard destructive actions with a modal when in demo mode
- [ ] Add scripted AI responses (mock Ollama service) so demo chat works without Ollama
- [ ] Add onboarding tooltips & "What can I try?" help sheet

### Demo scenario content (3 pre-seeded projects)

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

## Polish & Production-Ready
- [ ] **Progress Indicators** — Show real progress bars during embedding generation, document imports, and graph rebuilds (currently only boolean loading spinners exist).
- [ ] **Configurable keyboard shortcuts** — hotkey framework exists (`useHotkeys` hook + tests) but no user-facing remap UI in Preferences.
- [ ] **Auto-summarization on document upload** — summarization service exists but only runs on chat sessions via background scheduler; not triggered on document import.

---

## High-Impact Features

### 5. ⬜ Advanced Graph — Remaining
- [ ] **Time-based evolution** — a slider or animation showing how the graph grew over time, note by note

### 6. ⬜ Plugin Developer Experience
- [ ] Plugin SDK with documentation — a clearly defined API + README for third-party importers/exporters
- [ ] Example plugin template — minimal starter project with boilerplate
- [ ] Plugin testing framework — helpers for unit tests without a full app instance

> Note: A plugin manager UI exists (`PluginManagerView.tsx`) with enable/disable toggles for built-in plugins, but the Tauri runtime has no dynamic plugin loader — it is settings-only.

---

## Expand Ecosystem

### 7. 🔄 More Built-in Plugins
- [x] Markdown Exporter
- [x] Obsidian Exporter
- [x] YouTube Importer
- [x] Anki Exporter
- [ ] Kindle Highlights Importer — reads Amazon's `My Clippings.txt` and creates notes  ← **priority**
- [ ] Pocket / Instapaper Importer — pull saved articles as searchable knowledge
- [ ] RSS Feed Reader — subscribe to feeds and ingest articles as notes
- [ ] Goodreads Integration — import shelves and book notes
- [ ] Logseq / Roam Importer — parse JSON/EDN exports, preserve backlinks
- [ ] Mind Map Visualization — radial/tree layout alternative to force-directed graph  ← **priority**
- [ ] Timeline View — arrange notes chronologically on a horizontal timeline

### 8. 🔄 Enhanced Export / Import
- [x] Markdown export
- [x] JSON export
- [x] Obsidian vault export
- [x] LM Studio chat history import
- [x] Google Gemini Takeout import (text-only)
- [ ] Google Gemini Takeout import — **add support for parsing and copying attached media/images** into local storage
- [ ] Standalone interactive HTML export — self-contained `.html` with embedded graph  ← **priority**
- [ ] LaTeX export — `.tex` with citations and sectioning for academic papers
- [ ] Notion import/export — push/pull via Notion API
- [ ] Roam Research JSON import — convert block structure to flat notes
- [ ] Batch export — export all projects at once
- [ ] Export templates — Mustache/Handlebars-style template for formatted output

---

## Advanced Features

### 9. ⬜ AI Enhancements
- [ ] Auto-summarization on document upload — generate a TL;DR note alongside raw chunks on import
- [ ] Web model support — call OpenAI / Anthropic / Gemini APIs as optional model sources
- [ ] Browser automation rebrand follow-up — keep the current user-facing rename, then later clean up internal `web_*` identifiers, seeded labels, and provider-specific implementation names so the feature reads as manually configured browser automation throughout the codebase

### 10. 🔄 Collaboration & Sync
- [x] Git-based sync — `git_sync` service with auto-commit/push every ~5 min, configurable remote URL
- [ ] Conflict resolution UI — show a diff when two machines edited the same note offline
- [ ] Shared projects with permissions — read-only or read-write collaborator access
- [ ] iCloud sync — CloudKit or iCloud Drive for seamless Apple device sync
