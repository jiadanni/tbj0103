# Tauri App Roadmap — Aetherium

Scope: `todo.md` tracks the Tauri app only. Swift/macOS work may differ and is not reflected here unless explicitly noted.

Legend: [x] Complete · [/] Partial · [ ] Not started

---

## 🔄 Core UX & Navigation
- [x] **Topic Management**: Full topic editing in WorkspaceSettingsView—view auto-detected topics, add custom topics, remove/blacklist topics to prevent regeneration.
- [ ] **Project Scratchpad**: A persistent per-project markdown canvas/note for manual dumping of context that remains visible or easily accessible during chat.
- [/] **Unified 'Source' model**: Migrated Documents and Web Captures to a single `sources` table. (Backend complete; specialized views still being phased out).
- [ ] **Onboarding tooltips**: First-run tour highlighting the sidebar, model selection, and workspace switcher.
- [ ] **Progress Indicators**: Real progress bars (not just boolean spinners) for embedding, large document imports, and graph rebuilds.
- [ ] **Configurable keyboard shortcuts**: UI to remap Quick Search and Command Palette triggers.
- [ ] **Bulk operations**: Expand multi-select session handling beyond the current "Move Sessions" dialog.

## 📈 Observability & System Health

- [ ] **Quick Search Performance**: Optimize debounce for users with >500 notes; currently too aggressive.
- [ ] **SQL Connection Pool**: Investigate increasing pool size (currently 10) to prevent "Database Busy" during intense background work (topic analysis + indexing).

## 🚀 AI & RAG Enhancements
- [/] **Adaptive Context Window**: Show an indicator of current chat token count vs. estimated window limits.
- [/] **Auto-summarization**: Generate 1-sentence summaries for documents/web captures on upload (DB field exists; automation pending).
- [/] **Recursive Semantic Search**: Pull in outbound `[[wiki-links]]` for highly relevant RAG results to expand discovery.
- [ ] **Audio Transcription**: Frontend for transcribing audio content via local STT models (e.g., Whisper).
- [ ] **Calendar Alarms**: Dedicated view for managing AI-triggered reminders (backend commands ready).

## 🛠️ Technical Debt & Architecture
- [ ] **ChatView Componentization**: Refactor the 5k+ line `ChatView.tsx` into smaller, maintainable units: `MessageList`, `Composer`, `ChatSidebar`, and `GenerationStats`.
- [ ] **Api.ts Splitting**: Divide the 1.3k+ line monolithic IPC wrapper into domain-specific modules (e.g., `api.chat`, `api.workspace`, `api.system`).
- [ ] **Surgical FTS Triggers**: Optimize SQLite triggers to only update specific FTS rows on change, rather than full session re-indexing.
- [ ] **SQL Migrations**: Transition from monolithic `schema.sql` to a directory of versioned, incremental migration files.
- [ ] **Robust Stream Handling**: Refactor backend streaming to use stateful UTF-8 decoding to handle split multi-byte characters and JSON fragments reliably.

## 🛡️ Security & Privacy
- [ ] **Database Encryption**: Integrate SQLCipher or implement application-level encryption for content columns (currently stored in plaintext).
- [ ] **PIN Recovery flow**: Implement a "Mnemonic/Recovery Key" fallback or a secure "Reset App Data" flow on the PIN screen.
- [ ] **Secure JSON Extraction**: Replace substring-based extraction with a state machine to handle Markdown-wrapped AI responses more reliably.

## 📅 Data Lifecycle & Integrations
- [/] **Move projects between workspaces**: Drag-and-drop implementation for projects and orphaned sessions. (Notes/Sources migration pending).
- [ ] **Entity ownership logic**: Formalize rules for whether linked Notes/Docs move with a project or stay at the workspace root.


## 🎮 Demo Mode
- [ ] **"Try Demo" entry**: Allow jumping into demo mode from onboarding without requiring a PIN.
- [ ] **Scripted AI Mock**: Use a local mock service for AI responses to allow demo functionality without model downloads.

---


## 🐞 Known Issues
- [ ] **macOS PIN Lock Loop**: PIN screen re-appearing immediately if Touch ID is partially configured.
- [ ] **Flex Overflow**: Long file names can still break sidebar width in specific split-pane configurations.
- [ ] **Focus Drift**: Command Palette/Search Box closing sometimes scrolls the main window to the top on macOS.
- [ ] **Navigation Stalling**: Occasional view update failure when clicking a search result despite URL changes.
- [ ] **FTS Multi-word Tags**: Improved quoting needed for complex topic filters (Partially fixed).
no fit guidance for gemma 4 ✓
cpu status bar multicore
chat titles truncated unecessarily and missing a tooltip on hover
left click on icon to open search, right for menu ✓
scrolling chat to bottom hangs breifly jerky