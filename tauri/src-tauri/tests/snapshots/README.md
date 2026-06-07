# Migration upgrade snapshots

Sanitized `.sqlite` files representing the database at a specific
schema version. The dormant `migration-upgrade.yml` workflow runs the
current migration chain against each one and asserts none panic.

**Only commit snapshots produced by `cargo run --bin snapshot-db`.**
That binary is the single source of truth for what gets wiped. Never
copy a live `.sqlite` here directly — it will contain message bodies,
notes, and embeddings (the last of which can be inverted back to
their source text by anyone with the same embedding model).

## Cadence: one snapshot per `vN_*` migration

Capture a snapshot **before** writing the next migration. Workflow:

1. You're about to write `vN+1`.
2. Run `cargo run --bin snapshot-db` from `tauri/src-tauri/`.
3. It writes `snapshot_vN.sqlite` here. Idempotent — if the file
   exists, it does nothing.
4. `git add` + commit it (it prints the exact command).
5. Now write `vN+1`. CI tests it against every prior snapshot forever.

Old snapshots are never replaced. Each represents a different upgrade
starting point. Over a year you'll accumulate ~10–30 files; each is
~3–5 MB after sanitization. That's the right cost.

## The snapshot tool

`tauri/src-tauri/src/bin/snapshot_db.rs` is a small Rust binary that
does the capture end-to-end. From `tauri/src-tauri/`:

```bash
cargo run --bin snapshot-db                       # capture if not already present
FORCE=1 cargo run --bin snapshot-db               # overwrite the existing snapshot
ROW_CAP=200 cargo run --bin snapshot-db           # cap each table at 200 rows (default: 500)
ROW_CAP=0 cargo run --bin snapshot-db             # disable cap (heavy users: huge file)
AETHERIUM_DB=/path cargo run --bin snapshot-db    # non-default DB location
```

What it does:
1. Locates the live DB at the platform-standard `app_data_dir()`
   (Linux: `~/.local/share/com.aetherium.app/aetherium.db`).
2. Reads the highest `vN_*` from `_migrations` — that's the version.
3. Skips if `snapshot_vN.sqlite` already exists.
4. Copies the live DB to a temp file (never touches your real DB).
5. Caps each content table at ROW_CAP rows (oldest by rowid kept, so
   the rows that have been through the most migrations survive).
   Disables FK enforcement first so the cap can orphan child rows —
   harmless for a test fixture.
6. Wipes content-bearing columns (see CONTENT_COLUMNS in the source).
7. Truncates tables with UNIQUE-on-content constraints + log/FTS
   tables (see CONTENT_TABLES_TO_TRUNCATE).
8. Clears the FTS5 inverted index.
9. `VACUUM`s to reclaim space.
10. Atomic move into this directory.
11. Prints the `git add` line.

## What gets wiped

Conservative privacy pass — keeps schema shape and FK graph, drops
user-authored or model-generated content:

- Message bodies, chat titles, system prompts.
- Notes, daily notes, project notes, note templates.
- Documents, document chunks, sources, source chunks, web captures.
- Memories, memory summaries, conversation summaries.
- Concept names, descriptions, link contexts.
- Quiz prompts and answers.
- Glossary definitions.
- Artifacts (title, content, description).
- All embeddings (BLOB columns across the schema).
- All app logs (truncated wholesale).
- Workspace prompt bank (truncated — UNIQUE constraint).
- FTS5 search index (cleared via `delete-all`).

What's preserved:
- All IDs and FKs (the row graph the test exercises).
- Timestamps, counters, settings, model names.
- Schema definitions including triggers and indexes.
- Migration history (`_migrations` table contents).

## Adding new content tables

When a migration introduces a new table holding user content, add it
to `CONTENT_COLUMNS` in `src/bin/snapshot_db.rs`. If the new content
columns participate in a UNIQUE constraint, add to
`CONTENT_TABLES_TO_TRUNCATE` instead. The list is opt-in — forgetting
a table means the snapshot leaks that content.

## What's still missing

The test file itself. The CI workflow will skip cleanly if `.sqlite`
files exist here but no `tauri/src-tauri/tests/migration_upgrade.rs`
is present. Implementation should walk every `*.sqlite` in this
directory, call `aetherium_lib::db::initialize_database(&path)` on
each, and assert every `ALL_MIGRATION_NAMES` entry ends up in
`_migrations` after the call. See `docs/todo.md`.
