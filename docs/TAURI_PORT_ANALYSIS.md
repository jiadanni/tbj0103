# Tauri Port Analysis: Issues & Missing Functionality

## Summary

The Tauri port covers the majority of the Swift app's features. The backend (Rust commands, SQLite schema, services) is largely complete. The frontend has 19 views vs Swift's 29, but several Swift views are sub-components (autocomplete, pickers) rather than standalone pages. The main gaps are: **audio transcription** (no backend or UI), **several secondary views** (backup timeline, shortest path, template picker, chat export, alarm management), and **biometric auth enforcement**.

**Estimated overall parity: ~75%**

---

## 1. MISSING SERVICES (Tauri Backend)

| Swift Service | Tauri Equivalent | Status |
|--------------|-----------------|--------|
| AIContentGenerator | `ai_content_generator.rs` | Ported |
| AlarmManager | `commands/alarm.rs` | Ported (no fire/dismiss logic) |
| AppSettings | `services/settings.rs` | Ported |
| AutoContentGenerator | — | **Missing** (auto-generates notes from chat) |
| BackupService | `backup_service.rs` | Ported |
| ConceptExtractor | `concept_extractor.rs` | Ported |
| DocumentProcessor | `document_processor.rs` | Ported |
| ExportEngine | `export_engine.rs` | Ported |
| LinkSyntaxParser | `link_parser.rs` | Ported |
| LinkingEngine | `linking_engine.rs` | Ported |
| ModelOrchestrator | `commands/ai_model.rs` | **Partial** — priority list + token tracking exists, but no intelligent routing/fallback logic |
| NoteTemplateEngine | `note_template_engine.rs` | Ported |
| OllamaService | `ollama/client.rs` | Ported |
| RetrievalEngine | `retrieval_engine.rs` | Ported |
| SecurityManager | — | **Missing** — Touch ID flag stored but no biometric enforcement |
| SemanticSearchEngine | `semantic_search.rs` | Ported |
| SpacedRepetitionEngine | `spaced_repetition.rs` | Ported |
| VoiceTranscriptionService | — | **Missing** — No speech-to-text pipeline at all |

### Truly Missing:
- **VoiceTranscriptionService** — Swift uses `Speech` + `AVFoundation` for live mic transcription. No Tauri equivalent exists. The `AudioTranscription` model struct exists but has zero commands or UI.
- **SecurityManager** — Swift uses `LocalAuthentication` (LAContext) for Touch ID + auto-lock timer. Tauri stores the flag but never calls any platform auth API.
- **AutoContentGenerator** — Swift auto-generates notes/summaries from chat context. Not ported.

---

## 2. MISSING VIEWS (Frontend)

Tauri has **19 views**. Swift has **29 views**. Comparison:

| Swift View | Tauri Status | Notes |
|-----------|-------------|-------|
| AlarmView | **Missing** | No dedicated alarm management UI (create/list/delete via commands only) |
| AuthenticationView | Ported | |
| BacklinksView | Ported | |
| BackupSettingsSection | Ported | |
| BackupTimelineView | **Missing** | Visual timeline for backup history/restoration |
| ChatExportSheet | **Missing** | Export individual chat sessions (API exists, no UI) |
| ChatSessionListView | Ported | |
| ChatView | Ported | |
| CommandPaletteView | Ported | Integrated into Layout with Cmd+K |
| ConceptAutoCompleteView | **Missing** | Autocomplete when typing concept names |
| ContentView | Ported | → `Layout.tsx` |
| DailyNotesView | Ported | |
| DeduplicationView | Ported | |
| DocumentBrowserView | Ported | |
| FlashcardReviewView | Ported | |
| GroundedChatView | Ported | |
| KnowledgeGraphView | Ported | |
| LearningPathView | Ported | |
| MarkdownPreview | **Missing** | Standalone markdown preview pane |
| ModelComparisonView | Ported | |
| NoteEditorView | Ported | |
| PluginManagerView | Ported | |
| ProjectDashboardView | Ported | |
| ProjectSettingsView | **Missing** | Per-project custom instructions, color, icon editing |
| SettingsView | Ported | Includes AI model priority management |
| ShortestPathView | **Missing** | Visualize shortest path between concepts |
| SmartTextEditor | Ported | → `SmartTextEditor.tsx` (component) |
| TemplatePickerView | **Missing** | Select template when creating daily notes |
| WebCaptureView | Ported | (New — not in Swift as a standalone view) |
| WorkspaceListView | Ported | → `WorkspaceSettingsView.tsx` |

### Missing views (7):
1. **AlarmView** — manage/dismiss alarms visually
2. **BackupTimelineView** — visual backup history
3. **ChatExportSheet** — export single chat session
4. **ConceptAutoCompleteView** — inline autocomplete
5. **ProjectSettingsView** — edit project-level settings
6. **ShortestPathView** — graph path visualization
7. **TemplatePickerView** — template selection during note creation

---

## 3. MISSING/INCOMPLETE COMMANDS

### Audio Transcription (entirely missing)
- No `upload_audio`, `transcribe_audio`, `list_audio`, `delete_audio` commands
- `AudioTranscription` struct exists in `models/source.rs` but is never used
- `audio_transcriptions` table exists in schema but has no command handlers

### Alarm Management
- `create_alarm`, `list_alarms`, `delete_alarm` exist
- **Missing**: `update_alarm`, `dismiss_alarm`, `fire_alarm` (alarm firing/notification logic)

### Chat Branching
- Schema supports `parent_session_id` and `branch_message_id`
- **Missing**: `create_chat_branch`, `list_branches` commands (no UI for branching)

### Concept Links
- **Missing**: `update_concept_link` (can create/delete but not update strength/type)

---

## 4. IMPLEMENTATION GAPS

### Security
- Touch ID/biometric flag is stored and checked on boot (`App.tsx:34`) but no actual biometric API is called — the check just reads a boolean from settings
- Auto-lock timeout stored but no timer enforces it
- No platform-specific auth integration (macOS Touch ID, Windows Hello, etc.)

### Settings Reactivity
- Theme class is applied to `<html>` on change (works via `App.tsx:16-24`)
- Accent color is set as CSS variable (works)
- Font size setting exists but may not be applied to all components
- Ollama base URL IS exposed in settings (via `ollamaUrl` in settingsStore)

### Chat
- Streaming works with event listener pattern
- Message editing UI exists (edit/regenerate buttons)
- **Gap**: No branch visualization — schema supports it but UI doesn't expose it
- **Gap**: No chat export UI (API `export_markdown`/`export_json` exists)

### Knowledge Graph
- D3 force graph rendering works
- Concept CRUD works
- **Gap**: No concept autocomplete when creating links
- **Gap**: Shortest path algorithm exists (`find_shortest_path` command) but no visualization view
- **Gap**: Concept aliases stored but not used in search/autocomplete

### Notes
- NoteEditorView exists with create/edit/delete
- Daily notes with templates work
- **Gap**: No template picker modal during daily note creation
- **Gap**: MarkdownPreview as standalone component missing (ReactMarkdown used inline)

### Database
- **Database Migration System** — Implemented in `db/mod.rs` with version tracking in `_migrations` table. Allows for both additive and structural schema changes.
- **Database Connection Pool** — Implemented via `r2d2_sqlite` for thread-safe concurrent access.
- No pagination on list endpoints

---

## 5. FEATURE PARITY SCORECARD (Corrected)

| Feature | Swift | Tauri | Parity |
|---------|-------|-------|--------|
| Workspaces | Full | Full (switcher + settings view) | ~90% |
| Projects | Full | Missing ProjectSettingsView | ~80% |
| Chat Sessions | Full | Full (list, stream, edit, model select) | ~85% |
| Chat Branching | Full | Schema only, no UI | ~20% |
| Notes | Full | Editor exists, missing template picker | ~75% |
| Knowledge Graph | Full | D3 graph + CRUD, no autocomplete | ~75% |
| Flashcards | Full | Full | ~95% |
| Learning Goals | Full | Full | ~90% |
| Daily Notes | Full | Create + edit, no template picker | ~70% |
| Backups | Full | Create/restore/delete, no timeline view | ~70% |
| Document Import | Full | Full (upload + process + chunk) | ~90% |
| Web Capture | Full | Full (CRUD + UI) | ~85% |
| Audio Transcription | Full | Model only, zero functionality | **0%** |
| Grounded Chat | Full | Full (RAG pipeline) | ~85% |
| Settings | Full | AI models, themes, URL — no biometric | ~75% |
| Export | Full | Markdown/JSON/Obsidian | ~90% |
| Command Palette | Full | Integrated with Cmd+K | ~90% |
| Alarms | Full | Create/list/delete, no fire/dismiss | ~50% |
| Deduplication | Full | Full | ~90% |
| Model Comparison | Full | Full | ~90% |
| Plugins | Full | View exists | ~80% |
| Security/Auth | Full (Touch ID + auto-lock) | Flag only, no enforcement | **10%** |
| **OVERALL** | **100%** | | **~75%** |

---

## 6. RECOMMENDED FIXES (Priority Order)

### P0 — Blocks core workflows
1. **Audio Transcription** — Add commands + UI for voice recording/transcription (requires cross-platform speech-to-text; consider Whisper via Ollama or a native plugin)
2. **Biometric Auth Enforcement** — Wire Touch ID on macOS via `tauri-plugin-biometric` or native Rust LAContext bindings; on other platforms, fall back to password

### P1 — Significant feature gaps
4. **AlarmView** — Dedicated UI to manage, edit, and dismiss alarms with notification firing
5. **BackupTimelineView** — Visual timeline to browse and restore from backup snapshots
6. **ProjectSettingsView** — Edit custom instructions, color, icon per project
7. **Chat Branching UI** — Visualize and navigate message branches
8. **ShortestPathView** — Render shortest path results on the graph

### P2 — Polish
9. **TemplatePickerView** — Modal to select template during daily note creation
10. **ConceptAutoCompleteView** — Inline autocomplete for concept names
11. **ChatExportSheet** — UI to trigger per-session export
12. **MarkdownPreview** — Standalone preview component
13. **AutoContentGenerator** — Auto-generate notes from chat context
14. **Concept alias search** — Use stored aliases in keyword/semantic search

---

## 7. SCHEMA MISMATCH

The `web_captures` table uses `workspace_id` in the Tauri Rust commands but `project_id` in the SQL schema:
```sql
-- schema.sql
CREATE TABLE IF NOT EXISTS web_captures (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ...
);
```
```rust
// commands/web_capture.rs
pub fn create_web_capture(... workspace_id: String ...) {
    "INSERT INTO web_captures (id, workspace_id, ..."
```
This will cause a runtime SQL error. The column name needs to match.

---

## 8. ARCHITECTURAL CONCERNS

- **Database Connection Pool** — Implemented via `r2d2_sqlite`. Supports concurrent access across multiple command handlers.
- **No pagination** — `list_*` commands return all rows. Will degrade with large datasets.
- **`any[]` in graph algorithms** — `api.graphAlgo.pagerank()` returns untyped arrays. Add proper TypeScript interfaces.
- **Inconsistent API parameter style** — Some commands use `req: { ... }`, others use flat params. Should standardize.
- **No error boundaries** — React views don't have error boundaries; a single failed API call can blank the entire view.
