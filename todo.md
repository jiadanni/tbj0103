# Tauri App Roadmap — Aetherium

Scope: `todo.md` tracks the Tauri app only. Swift/macOS work may differ and is not reflected here unless explicitly noted.

Legend: [x] Complete · [/] Partial · [ ] Not started

---

## 🔄 UI & Navigation Refinements
- [ ] **Project Scratchpad**: A persistent per-project markdown canvas/note for manual dumping of context that remains visible or easily accessible during chat.
- [/] **Unified 'Source' model**: Migrating both Documents and Web Captures to a single `sources` table with type-specific metadata. (Backend complete and SourceBrowserView implemented, but specialized views still co-exist).
- [ ] **Onboarding tooltips**: First-run tour highlighting the sidebar, model selection, and workspace switcher.
- [ ] **Progress Indicators**: Real progress bars (not just boolean spinners) for embedding, large document imports, and graph rebuilds.
- [ ] **Calendar Alarms UI**: Implementation of a dedicated view for managing scheduled AI-triggered prompts (backend commands exist).
- [ ] **Audio Transcription UI**: Frontend for uploading and transcribing audio content via local STT models (e.g., Whisper).

## 🔄 Feature Consolidation
- [ ] **Chat & Thought Queue Merger**: Move the "Passive Processing" (Thought Queue) into a specialized "Scheduled Chat" or "Background Thought" state within the main Chat view.
- [/] **Graph & Flashcard Unification**: Show related flashcards directly within the Knowledge Graph detail panel when a concept is selected. (Basic integration in KG view exists).
- [/] **Adaptive Context Window**: Show a small indicator of the current chat's token count and estimated context window usage (requires `tiktoken` or rough char-count estimation).

## ⬜ Security — PIN Recovery
- [ ] **Forgotten PIN**: A "Reset App Data" flow on the PIN entry screen. Since data is local, loss of PIN means loss of data unless we implement a recovery key (Mnemonic).

## 🔄 Data Lifecycle & Migrations
- [/] **Move projects between workspaces**: Allow dragging a project (and its orphaned sessions) from the Sidebar into a different workspace. (Implemented for chat sessions/project container, but notes/sources/flashcards are not yet moved).
- [ ] **Entity ownership rules**: When a project moves, determine whether its linked Notes, Documents, and Flashcards move with it or remain workspace-global.

## Demo Mode (Remaining Work)
- [x] **Show demo banner**: A fixed banner in the Sidebar/Layout when `isDemoMode` is true.
- [/] **Guard destructive actions**: Pre-emptively disable Delete/Edit buttons or show "Not available in Demo" alerts. (Implemented for sessions and workspaces).
- [ ] **Add "Try Demo" button**: Ensure the Authentication/Onboarding screen allows users to jump into the Demo without setting a PIN.
- [ ] **Scripted AI responses**: Use a mock Ollama service for the Demo to ensure it works even if the user hasn't downloaded models yet.
- [ ] **Demo scenario content**: Replace the placeholder demo workspace with a high-quality "Japanese Language Learning" or "Biology 101" scenario with existing notes/concepts.

## Polish & Production-Ready
- [/] **Auto-summarization**: Automatically generate a 1-sentence summary of documents/web captures on upload using the background model. (Field exists in DB, but automation not triggered).
- [ ] **Configurable keyboard shortcuts**: UI to remap the Quick Search and Command Palette triggers.
- [x] **Git-based sync**: Initial implementation of `git push/pull` for the SQLite database and attachments to a private remote repository.
- [x] **Google Gemini Takeout import (text-only)**.

## High-Impact Features
- [/] **RAG: recursive semantic search**: If a search result is highly relevant, also pull in its outbound `[[wiki-links]]` even if they don't match the keyword.
- [x] **Flashcard AI: direct extraction from concept context**.
- [ ] **Flashcard AI: highlight text to create card**.
- [ ] **Knowledge Graph: radial tree layout mode**.

---

### Recently Completed
- [x] Integrated Preferences Hub (AI Models, Sync, Security).
- [x] Modernized knowledge graph visualization (force-directed d3).
- [x] Workspace Topic Signatures & Topic-based Routing.
- [x] Multi-pane workspace support (Split View).
- [x] Transparent proxy support for Ollama.

---

### Known Issues
- [ ] **PIN Lock Loop**: On some macOS systems, the PIN screen re-appears immediately after entering a valid PIN if Touch ID is partially configured.
- [ ] **Flex overflow issue**: Long file names in the document browser can break the sidebar width in split-pane mode.
- [/] **Bulk operations**: Multi-select sessions for move/delete is currently limited to the "Move Sessions" dialog.
- [ ] **Quick Search lag**: If the user has >500 notes, the initial search debounce is too aggressive.

# Bug
• You’re right. New Search is explicitly turning search on, regardless of the normal default. 

Here are the issues I’m tracking: 
• On MacOS, searching with Search Box (not the one in side bar) causes focus to shift to main window when Search Box closes. This causes window to scroll to top. 
• Also happens when Command Palette is closed. 
• If you click a search result that should trigger navigation, it sometimes fails to update the view even though the URL changes. 

Other items: 
• Move flashcards, webcaptures and notes from Project to work space. 
• Flashcards should have a global view. 

Models to add: 
  ollama
  lms
  mlx