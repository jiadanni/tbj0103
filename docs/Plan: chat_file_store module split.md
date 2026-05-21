  Plan: chat_file_store module split

  Goal

  Break mod.rs (1523 lines, 60 symbols) into focused files. Every public function
   stays reachable at the same chat_file_store::* path — mod.rs becomes a thin
  re-export hub.

  ---
  Target layout

  chat_file_store/
  ├── mod.rs           (~80 lines) — shared types + pub use re-exports
  ├── session_io.rs    (~450 lines) — file paths, read/write, encryption, import,
   reencrypt
  ├── lmstudio.rs      (~310 lines) — LM Studio structs + parser + discovery
  ├── gemini.rs        (~160 lines) — Gemini/Google Takeout parser
  ├── claude_legacy.rs (~380 lines) — Claude legacy structs + all preview/parse
  fns
  └── claude_v2.rs     (exists)    — unchanged

  ---
  What moves where

  Lines (approx): 30–52
  Content: ChatFileData, ChatFileMessage
  → File: mod.rs (stay as public types)
  ────────────────────────────────────────
  Lines (approx): 57–63
  Content: EncryptedFile
  → File: session_io.rs (private)
  ────────────────────────────────────────
  Lines (approx): 69–409
  Content: session_file_path*, sanitize_dir_name, SessionFileVariants,
    capture_session_file_variants, sync_session_files_for_hierarchy_change,
    derive_key, load_from_db, write_session_file, delete_session_file,
    read_session_file, import_session_from_file
  → File: session_io.rs
  ────────────────────────────────────────
  Lines (approx): 410–901
  Content: All Lm* structs, lm_effective_system_prompt, epoch_ms_to_iso,
    extract_messages_from_lm_conversation, parse_lmstudio_conversation,
    DiscoveredConversation, discover_lmstudio_conversations
  → File: lmstudio.rs
  ────────────────────────────────────────
  Lines (approx): 764–902
  Content: import_chat_data, reencrypt_all_files, reencrypt_walk
  → File: These straddle LM Studio — import_chat_data and reencrypt_* go to
    session_io.rs
  ────────────────────────────────────────
  Lines (approx): 905–1080
  Content: parse_gemini_takeout, create_session_from_messages
  → File: gemini.rs
  ────────────────────────────────────────
  Lines (approx): 1081–1523
  Content: All Claude* structs, extract_claude_message_content,
    extract_claude_message_content_v2, claude_conversation_to_chat_data,
    parse_claude_*, preview_claude_*, preview structs
  → File: claude_legacy.rs

  ---
  Cross-cutting dependencies to watch

  1. ChatFileData / ChatFileMessage — used by all files. Stay in mod.rs, imported
   via use super::{ChatFileData, ChatFileMessage} in each submodule.
  2. EncryptedFile — private to session_io.rs, not re-exported.
  3. extract_claude_message_content_v2 in mod.rs currently references
  claude_v2::V2Message. After the move it lives in claude_legacy.rs — same use
  super::claude_v2 import pattern works unchanged.
  4. import_chat_data — called by session_io.rs internals and by
  commands/chat_file.rs. Moves to session_io.rs, re-exported from mod.rs.
  5. reencrypt_all_files / reencrypt_walk — encryption helpers, go to
  session_io.rs.
  6. parse_claude_projects — currently called only from mod.rs itself (legacy
  import path). After move it stays in claude_legacy.rs; if commands/chat_file.rs
   still references it after the previous refactor, mod.rs re-exports it.

  ---
  mod.rs after the split (~80 lines)

  pub mod claude_v2;
  mod session_io;
  mod lmstudio;
  mod gemini;
  mod claude_legacy;

  // Shared public types
  pub use session_io::{
      session_file_path, session_file_path_for_session,
      SessionFileVariants, capture_session_file_variants,
      sync_session_files_for_hierarchy_change,
      write_session_file, delete_session_file,
      read_session_file, import_session_from_file,
      import_chat_data, reencrypt_all_files,
  };
  pub use lmstudio::{
      parse_lmstudio_conversation,
      DiscoveredConversation, discover_lmstudio_conversations,
  };
  pub use gemini::parse_gemini_takeout;
  pub use claude_legacy::{
      ClaudeConversationPreview, ClaudeProjectPreview,
      ClaudeMemoryPreview, ClaudeProjectMemoryPreview,
      parse_claude_conversations, parse_claude_projects,
      parse_claude_conversations_filtered,
      preview_claude_conversations, preview_claude_projects,
      preview_claude_memories,
  };

  // Shared base types (kept here — used by all submodules)
  #[derive(Debug, Clone, Serialize, Deserialize)]
  pub struct ChatFileData { ... }
  #[derive(Debug, Clone, Serialize, Deserialize)]
  pub struct ChatFileMessage { ... }

  ---
  Steps (in order)

  1. Create session_io.rs — move EncryptedFile, derive_key, sanitize_dir_name,
  session_file_path*, SessionFileVariants, capture_session_file_variants,
  sync_session_files_for_hierarchy_change, load_from_db, write_session_file,
  delete_session_file, read_session_file, import_session_from_file,
  import_chat_data, reencrypt_all_files, reencrypt_walk. Add use
  super::{ChatFileData, ChatFileMessage}.
  2. Create lmstudio.rs — move all Lm* structs and functions
  (lm_effective_system_prompt, epoch_ms_to_iso,
  extract_messages_from_lm_conversation, parse_lmstudio_conversation,
  DiscoveredConversation, discover_lmstudio_conversations). Add use
  super::{ChatFileData, ChatFileMessage}.
  3. Create gemini.rs — move parse_gemini_takeout, create_session_from_messages.
  Add use super::{ChatFileData, ChatFileMessage}.
  4. Create claude_legacy.rs — move everything from line 1081 onward (all Claude
  structs, extract_claude_message_content, extract_claude_message_content_v2,
  preview/parse functions, preview structs). Add use super::{ChatFileData,
  ChatFileMessage, claude_v2}.
  5. Rewrite mod.rs — keep only ChatFileData, ChatFileMessage, the module
  declarations, and pub use re-exports.
  6. cargo check after each step — catch visibility or import errors immediately
  rather than debugging four files at once.
  7. cargo clippy -- -D warnings on the touched files, tsc --noEmit (no frontend
  changes expected).

  ---
  Risks / notes

  - The extract_claude_message_content_v2 function in mod.rs references
  claude_v2::V2Message — when it moves to claude_legacy.rs, the import becomes
  use super::claude_v2 which works identically.
  - parse_claude_projects may or may not still be called from
  commands/chat_file.rs after the previous refactor. Check with grep before
  deciding whether to re-export it.
  - No callers outside src-tauri/ reference these symbols directly, so no
  frontend changes needed.
  - The pre-existing clippy errors in dashboard.rs and topic_signature.rs are
  unrelated — don't fix them as part of this task.
