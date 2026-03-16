# Tauri Port Analysis: Issues & Missing Functionality

## Summary
The Tauri/React port (66 Swift files → 23 TS/TSX files) is functionally incomplete. Key features are missing or stubbed, particularly around content capture, voice transcription, and graph utilities.

---

## 1. MISSING SERVICES (Tauri Backend)

### Critical Missing:
- **VoiceTranscriptionService** — No audio transcription pipeline
  - Swift has full transcription + processing
  - Tauri has `AudioTranscription` data model but no command handlers
  - Missing: `transcribe_audio`, `process_audio` commands

- **ModelOrchestrator** — No multi-model switching/orchestration
  - Swift app compares models and routes queries
  - Tauri uses single static model
  - Missing: intelligent model selection, fallback logic

- **SecurityManager** — Touch ID/biometric authentication only partially ported
  - Swift: Full biometric + timeout-based lock
  - Tauri: Only basic touch_id_enabled flag, no actual enforcement
  - Missing: Platform-specific auth (Windows Hello, Linux fingerprint)

- **ThemeManager** — Theme/color management
  - Swift: Full theme switching + custom accent colors
  - Tauri: Settings stored but not fully implemented in UI
  - State exists in `settingsStore.ts` but not reactive

---

## 2. MISSING VIEWS (Frontend)

| Swift View | Tauri Status | Issue |
|-----------|-------------|-------|
| `AlarmView` | ✅ Partial | Alarms created but no visual management UI |
| `BackupTimelineView` | ❌ Missing | Shows backup history/restoration timeline |
| `ChatExportSheet` | ❌ Missing | Export individual chats (exists in API, no UI) |
| `ChatSessionListView` | ❌ Missing | Sidebar list of chat sessions per project |
| `CommandPaletteView` | ❌ Missing | ⌘K command palette (struct exists, not integrated) |
| `ConceptAutoCompleteView` | ❌ Missing | Autocomplete for concept creation |
| `ContentView` | ✅ Replaced | Now `Layout.tsx` (partial parity) |
| `DeduplicationView` | ❌ Missing | Merge duplicate concepts/notes |
| `MarkdownPreview` | ❌ Missing | Markdown preview pane |
| `NoteEditorView` | ❌ Missing | Dedicated note editing UI |
| `ProjectSettingsView` | ❌ Missing | Per-project settings (custom instructions, etc.) |
| `ShortestPathView` | ❌ Missing | Visualize concept graph shortest paths |
| `TemplatePickerView` | ❌ Missing | Select templates when creating daily notes |
| `WorkspaceListView` | ⚠️ Partial | Sidebar only, no workspace management UI |

**Impact**: Users cannot manage backups visually, edit notes standalone, pick templates, or access advanced graph analytics.

---

## 3. MISSING COMMANDS (Tauri Backend)

### Web Capture
- `capture_webpage` ❌ (data model exists)
- `process_web_capture` ❌
- `update_web_capture` ❌
- `delete_web_capture` ❌
- `list_web_captures` ❌

### Audio Transcription
- `upload_audio` ❌
- `transcribe_audio` ❌ (requires speech-to-text integration)
- `process_audio` ❌
- `delete_audio` ❌
- `list_audio_files` ❌

### Note & Template Management
- `update_daily_note` ❌ (can create/read, not update)
- `delete_template` ❌
- `update_template` ❌

### Concept & Link Management
- `update_concept_link` ❌
- `reorder_concept_links` ❌

### Chat Session Management
- `update_chat_session` ❌ (update title, pin status)
- `create_chat_branch` ❌ (branch from message)
- `merge_chat_branches` ❌

### Advanced Graph
- `find_similar_concepts` ❌ (semantic similarity)
- `suggest_concept_links` ❌ (auto-link suggestions)
- `get_concept_influence_score` ❌

### Project Management
- `get_project_stats` ❌
- `update_project_settings` ❌ (custom instructions, etc.)

### Workspace Management
- Multi-workspace context switching ⚠️ Partial (backend exists, UI incomplete)

---

## 4. MISSING FEATURES (Implementation Gaps)

### UI/UX Issues
- **Command Palette** — Component exists (`CommandPalette.tsx`) but never integrated into Layout
- **Keyboard Shortcuts** — No global shortcut handling (⌘+K, etc.)
- **Workspace Switcher** — Can only switch on startup, not in-app
- **Chat Branching UI** — Backend supports branches, no UI to visualize/manage
- **Search Results Display** — `semantic_search` command works, no dedicated results view
- **Graph Visualization** — D3 graph exists but doesn't fully sync with concept node positions

### Settings
- Theme customization not reactive (Settings exist but don't update UI in real-time)
- Touch ID timeout enforcement missing (flag set but never checked)
- Ollama base URL override not exposed in UI
- Font size setting not applied to editor

### Data Features
- **Web Capture** — Tables/models exist, zero UI/commands
- **Audio Transcription** — Tables/models exist, zero UI/commands
- **Auto-Linking** — Can parse wiki-links but no intelligent suggestion UI
- **Concept Aliases** — Stored in schema but never used in search/autocomplete
- **Note Templates** — Can create/list, cannot delete or edit
- **Daily Note Templates** — Can apply, cannot select during creation

### Performance/Reliability
- No progress indicators for long operations (document processing, embedding generation)
- No error boundaries in chat streaming
- No optimistic UI updates for CRUD operations
- Database connection pooling may cause contention under load

---

## 5. ARCHITECTURAL ISSUES

### Type Safety
- `Partial<>` types in API calls — many fields optional when they shouldn't be
- Missing discriminated unions for `ProjectSourceType` (document vs web vs audio)
- `any[]` return types in graph algorithms (no typed results)

### State Management
- No optimistic updates in chat/note creation
- Store mutations not isolated (could cause race conditions)
- No loading/error states for async operations in many views

### Database
- No migrations system (schema.sql applied on first run only)
- No transaction support for multi-table operations
- Foreign key constraints can silently cascade (no soft deletes)
- No compound indexes for common join patterns

### API Design
- Inconsistent parameter naming (req: {...} vs direct fields)
- No pagination for list operations (can load 10k concepts at once)
- No batch operations (delete multiple items requires N calls)
- Stream events hardcoded to session_id (no other streams implemented)

---

## 6. FEATURE PARITY SCORECARD

| Feature | Swift | Tauri | Status |
|---------|-------|-------|--------|
| Workspaces | ✅ | ⚠️ (no switcher) | ~70% |
| Projects | ✅ | ⚠️ (no settings) | ~60% |
| Chat Sessions | ✅ | ⚠️ (no branches/list) | ~50% |
| Notes | ✅ | ❌ (no editor, templates partial) | ~30% |
| Knowledge Graph | ✅ | ⚠️ (read-only visualization) | ~50% |
| Flashcards | ✅ | ✅ | ~95% |
| Learning Goals | ✅ | ✅ | ~90% |
| Daily Notes | ✅ | ❌ (creation only) | ~20% |
| Backups | ✅ | ⚠️ (create/restore, no timeline) | ~60% |
| Document Import | ✅ | ✅ | ~90% |
| Web Capture | ✅ | ❌ (model only) | 0% |
| Audio Transcription | ✅ | ❌ (model only) | 0% |
| Grounded Chat | ✅ | ✅ | ~85% |
| Settings | ✅ | ⚠️ (many not applied) | ~40% |
| Export (Markdown/JSON/Obsidian) | ✅ | ✅ | ~90% |
| **OVERALL** | **100%** | **~55%** | |

---

## 7. RECOMMENDED FIXES (Priority Order)

### P0 (Critical — blocks core workflows)
1. **Complete Web Capture UI + Commands**
   - Files: Add `capture_web.tsx` view, `web_capture` command handlers
   - Impact: Users can't import web content

2. **Complete Audio Transcription UI + Commands**
   - Files: Add `audio_transcription.tsx` view, speech-to-text integration
   - Impact: Voice memo feature completely missing

3. **Implement CommandPalette integration**
   - Wire `CommandPalette.tsx` into `Layout.tsx`
   - Impact: Major UX regression vs Swift app

4. **Fix Settings reactivity**
   - Make theme/font changes apply in real-time
   - Impact: Settings menu appears broken

### P1 (High — significant feature loss)
5. **Add Chat Session List UI** (`ChatSessionListView.tsx`)
6. **Implement Note Editor** (`NoteEditorView.tsx`)
7. **Add Workspace Switcher** to navbar
8. **Implement Concept Deduplication** (`DeduplicationView.tsx`)
9. **Add Backup Timeline** (`BackupTimelineView.tsx`)

### P2 (Medium — nice-to-have gaps)
10. **Template Picker** during daily note creation
11. **Concept Autocomplete** during graph editing
12. **Chat Export Sheet** for individual session export
13. **Shortest Path Visualization**
14. **ModelOrchestrator** for multi-model queries

---

## 8. QUICK WINS (Low effort, high impact)

- Add missing `update_note` form to `NoteEditorView` (15 min)
- Expose `ollama_base_url` setting in Settings UI (10 min)
- Wire Command Palette to Layout (5 min)
- Add delete buttons to template list (10 min)
- Implement theme toggle reactivity (20 min)
- Add progress indicator to chat streaming (15 min)

---

## Files Reference

**Missing/Incomplete Frontend:**
- `tauri/src/views/NoteEditorView.tsx` ❌
- `tauri/src/views/CommandPaletteView.tsx` (exists, not integrated)
- `tauri/src/views/ChatSessionListView.tsx` ❌
- `tauri/src/components/TemplatePickerView.tsx` ❌

**Missing Backend Commands:**
- `tauri/src-tauri/src/commands/web_capture.rs` ❌
- `tauri/src-tauri/src/commands/audio.rs` ❌

**Store Updates Needed:**
- `tauri/src/stores/settingsStore.ts` (needs reactivity)
- `tauri/src/stores/workspaceStore.ts` (needs switcher)
