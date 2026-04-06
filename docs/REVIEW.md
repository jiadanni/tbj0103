lan: Aetherium Architecture Review & Refactoring Roadmap
Comprehensive architecture review identified 1 critical issue (database index performance), 7 high-impact improvements (permissions, ChatView refactor, state coupling), and 10 medium-priority enhancements. The codebase has a solid foundation with clear separation of concerns, but needs focused refactoring in three areas: frontend component complexity, database schema setup, and file I/O permissions.

Phase 1: Critical Fixes (Sprint 1, Week 1)
Steps:

Fix missing binary file support — add fs:allow-read-file and fs:allow-write-file to capabilities/default.json (parallel with 2-4)
Move database indexes from migration v9 to schema.sql — fresh installs run without indexes causing performance cliff (parallel with 3)
Add 50MB max file size validation in commands/document.rs upload handler (parallel with 2)
Replace .unwrap() calls with .map_err()? in services/context_assembler.rs lines 54, 65, 74, 85+
Phase 2: High-Impact Improvements (Sprint 1-2, Weeks 2-4)
Steps:
5. Refactor 1500-line ChatView.tsx into 6 sub-components — reduces 21 useEffect calls, improves maintainability (depends on 8)

Extract: ChatSessionSidebar.tsx (250 lines), ChatMessageContainer.tsx (400 lines), DualModelDraft.tsx (180 lines), ThoughtQueuePanel.tsx (200 lines), ChatComposer.tsx (~200 lines)
Remove cross-store coupling — extract useChatStore.getState().setActiveChatId(null) from workspaceStore.ts:256 into useWorkspaceChatSync() hook in Layout.tsx (parallel with 7)
Add input validation layer — create src-tauri/src/validation.rs with Validatable trait for command request types (max length, non-empty, valid charset) (parallel with 6)
Audit ChatView effect dependencies — review all 21 useEffect calls for missing dependencies and infinite loop risks; add exhaustive-deps ESLint rule (blocks step 5)
Phase 3: Medium-Priority Enhancements (Sprint 2-3, Weeks 5-8)
Steps:
9. Replace as any type assertions in SettingsView.tsx:136, KnowledgeGraphView.tsx:300, LearningPathView.tsx:37 with proper TypeScript types (parallel with 10-11)
10. Implement virtualized rendering for large lists — use react-window in ChatSessionSidebar.tsx and DocumentBrowserView.tsx to handle 500+ items (parallel with 9, 11)
11. Add pagination to search commands — add offset parameter to commands/search.rs and totalCount to responses (parallel with 9-10)
12. Replace Result<T, String> with structured Result<T, AppError> enum (NotFound, Validation, Database, Internal) in src-tauri/src/errors.rs
13. Refactor settings sync — replace 15+ setter calls in SettingsView.tsx:136 with single settingsStore.syncFromDB() action (parallel with 14)
14. Improve Ollama streaming error handling — add "error" event type to ollama/client.rs and retry UI in frontend (parallel with 13)
15. Add transaction support — create src-tauri/src/db/transaction.rs wrapper for multi-statement operations (create artifact + embedding + memory)

Long-Term Considerations (Future)
Ollama model context-size detection — call /api/show/:model API to use model-specific limits instead of hard-coded 8192 tokens
Make context budget percentages configurable — move hard-coded 10% memories, 45% conversation, etc. from context_assembler.rs to settings
Add unit tests for command handlers — test error cases (locked DB, constraint violations)
Add integration tests for database migrations — test fresh schema.sql → v1-v9 migration path