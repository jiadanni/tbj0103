# Knowledge Graph: Model Upgrade Plan

Make `analyze_workspace` improve the graph (not just append to it) when the user swaps in a stronger model, while preserving user progress and edits. Default to fully automatic behaviour with a settings escape hatch and a single-click undo.

## Motivation

Today `analyze_workspace` is purely additive:

- `upsert_node` in `src-tauri/src/commands/ai_knowledge.rs:759` returns early on any name/alias match and never updates description, type, or hierarchy level.
- `upsert_link` in `ai_knowledge.rs:792` checks only `(source_id, target_id)`, so a stale `related` link blocks a new `prerequisite` upgrade.
- The only DELETEs against `concept_nodes` / `concept_links` are user-initiated (`commands/knowledge_graph.rs`), demo reset, and one maintenance path in `db/mod.rs`.

Consequence: upgrading from e.g. an 8B to a 70B model gives strictly worse results than expected — better descriptions are discarded, vague legacy concepts ("Key Ideas", "Best Practices") persist forever, and link-type upgrades are silently blocked.

## Design principles

1. **Augment, don't replace.** Never delete; supersede with a back-pointer so the user can recover.
2. **Preserve user progress.** `review_count`, graph layout (`x_position`, `y_position`), `created_at`, `id`, and any user-edited field survive every re-analysis.
3. **Zero input by default.** Auto-upgrade and auto-supersede run during analysis with no prompts. Settings allow `suggest` or `off` for users who prefer review.
4. **Atomic undo.** Every change from one analysis run carries a `last_modified_by_job` stamp so "Undo last analysis" is one query.

## Schema changes

All migrations follow the existing additive `ALTER TABLE ... ADD COLUMN` style in `src-tauri/src/db/mod.rs` (see `db/mod.rs:247`, `:260`, `:333`, etc.). New columns on `concept_nodes`:

```sql
source_model TEXT,                                    -- e.g. "llama3.1:8b", NULL for user-created
confidence REAL NOT NULL DEFAULT 0.5,                 -- 0.0..1.0
user_edited_fields TEXT NOT NULL DEFAULT '[]'         -- JSON array, e.g. ["name","concept_description"]
    CHECK (json_valid(user_edited_fields)),
superseded_by TEXT REFERENCES concept_nodes(id) ON DELETE SET NULL,
superseded_at TEXT,
supersede_reason TEXT,
last_modified_by_job TEXT                             -- analyze_jobs.id, for undo
```

Same `source_model` / `confidence` / `user_edited_fields` / `last_modified_by_job` on `concept_links`.

Update `schema.sql` (source of truth) and append matching `ALTER TABLE` statements to the migration chain in `db/mod.rs`.

## Confidence heuristic

In `ai_knowledge.rs`, a single function maps model name → confidence tier. Crude on purpose; refine later if we want self-reported scores.

```rust
fn model_confidence(model: &str) -> f64 {
    let m = model.to_lowercase();
    if m.contains("70b") || m.contains("72b") { 0.95 }
    else if m.contains("32b") || m.contains("34b") { 0.85 }
    else if m.contains("13b") || m.contains("14b") { 0.75 }
    else if m.contains("7b")  || m.contains("8b")  { 0.60 }
    else if m.contains("3b")  || m.contains("4b")  { 0.45 }
    else { 0.50 }
}
```

## Upgrade-in-place upsert (replaces current `upsert_node`)

Behaviour for an existing concept match:

- Read `(confidence, user_edited_fields, concept_description, concept_type, hierarchy_level)`.
- If `new_confidence > old_confidence + threshold` (default 0.05), UPDATE the fields **not** listed in `user_edited_fields`. Stamp `source_model`, `confidence`, `last_modified_by_job`, `updated_at`.
- Description is only overwritten if the new one is longer than the old (cheap quality proxy).
- `id`, `name`, `review_count`, `created_at`, `x_position`, `y_position`, `tags`, `aliases` are **never** touched in the upgrade path. Name changes go through supersede.

Behaviour for a new concept: INSERT with `source_model = new`, `confidence = model_confidence(model)`, `last_modified_by_job = current_job_id`.

`upsert_link` follows the same pattern, keyed on the existing unique index `(source_id, target_id, link_type)`. A weaker model's `related` link can be upgraded to `prerequisite` by a stronger one if the link is not user-edited.

**Per-link confidence keying** (open question from the discussion): keep the existing triple key `(source_id, target_id, link_type)`. A type-upgrade therefore inserts a new row alongside the old one, then the supersede pass consolidates. Simpler than retrofitting the unique index.

## Supersede pass

Runs as a second pass at the end of `analyze_chunk`, gated by `knowledge.supersede_mode = "auto"`.

Prompt the same model with:
- Low-confidence existing concepts in this workspace (`confidence < 0.6`).
- High-confidence concepts just inserted in this run.

Ask it to return, per old concept, one of: `keep`, `supersede_by <new_id>`, `merge_into <new_id>` with a reason.

Apply in Rust:

```rust
fn apply_supersede(conn, old_id, new_id, reason, now, job_id) {
    // 1. Non-destructive mark.
    UPDATE concept_nodes
       SET superseded_by = ?, superseded_at = ?, supersede_reason = ?,
           last_modified_by_job = ?, updated_at = ?
     WHERE id = ? AND COALESCE(superseded_by, '') = '';

    // 2. Transfer accumulated user progress to the successor.
    UPDATE concept_nodes
       SET review_count = review_count + (SELECT review_count FROM concept_nodes WHERE id = ?)
     WHERE id = ?;

    // 3. Re-point user-edited inbound links to the successor.
    //    AI-authored links are left dangling; the graph filters them.
    UPDATE concept_links
       SET target_id = ?, last_modified_by_job = ?
     WHERE target_id = ? AND json_array_length(user_edited_fields) > 0;
}
```

Guard rails:
- Never supersede a node with non-empty `user_edited_fields`.
- Never supersede a node with `review_count > 0` unless action is `merge_into` (which transfers the count).
- Cycle check before applying — reuse `would_create_cycle` from `services/concept_hierarchy_service.rs:148`.

## Settings (escape hatch)

Three keys in the existing `settings` table. All defaults preserve the zero-input experience.

| Key | Values | Default |
|---|---|---|
| `knowledge.upgrade_mode` | `auto` / `suggest` / `off` | `auto` |
| `knowledge.supersede_mode` | `auto` / `suggest` / `off` | `auto` |
| `knowledge.confidence_threshold` | float 0.0..1.0 | `0.05` |

Modes:

| Mode | During analysis | Surfacing |
|---|---|---|
| `auto` | Apply changes immediately | Toast "Improved N concepts, consolidated M" + Undo |
| `suggest` | Write to `concept_change_proposals` table; no DB mutation | "Review N suggestions" badge on graph view |
| `off` | Skip entirely | — |

`suggest` mode requires a new table:

```sql
CREATE TABLE IF NOT EXISTS concept_change_proposals (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    job_id TEXT REFERENCES analyze_jobs(id) ON DELETE CASCADE,
    proposal_type TEXT NOT NULL CHECK (proposal_type IN ('upgrade','supersede','merge')),
    target_node_id TEXT REFERENCES concept_nodes(id) ON DELETE CASCADE,
    payload TEXT NOT NULL CHECK (json_valid(payload)),  -- proposed fields or successor id
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Undo

Because every mutation carries `last_modified_by_job`, undoing the most recent analysis is a single command:

```rust
pub async fn undo_last_analysis(workspace_id) -> Result<UndoStats, String> {
    // 1. Look up the most recent completed analyze_jobs row for the workspace.
    // 2. For concept_nodes:
    //    - DELETE rows where created_at >= job.started_at AND last_modified_by_job = job.id.
    //    - UPDATE rows where last_modified_by_job = job.id to clear superseded_by/at/reason.
    //    - (Field-level reverts on UPDATEs require a change log — see Open Questions.)
    // 3. For concept_links: same shape.
}
```

Field-level reverts (e.g. undoing an upgraded `concept_description`) need a `concept_node_revisions` table if we want true history. Cheapest path: log a `(node_id, job_id, before_json)` row per UPDATE during analysis. Defer until v2.

## Implementation order

1. **Schema migration** — add columns + `concept_change_proposals` table. Verify with `cargo check`.
2. **Confidence heuristic** — single function in `ai_knowledge.rs`. Unit test.
3. **Upgrade-in-place upsert** — replace `upsert_node` and `upsert_link`. Run `analyze_workspace` twice on a fixture workspace, second time with a stronger model name, confirm fields update.
4. **`last_modified_by_job` stamping** — thread the current job id through `analyze_chunk`. Confirm every INSERT/UPDATE in the analysis path carries it.
5. **Supersede pass** — implement the second-pass prompt + `apply_supersede`. Cycle check, guard rails, unit tests.
6. **Settings keys** — add the three keys with defaults. Wire `upgrade_mode` / `supersede_mode` gating into the analysis path.
7. **Suggest mode** — `concept_change_proposals` writes + a `list_change_proposals` / `apply_change_proposal` / `dismiss_change_proposal` command trio.
8. **Undo last analysis** — command + UI button. Toast-level surfacing first; revision log deferred.
9. **Graph view filter** — `WHERE superseded_by IS NULL` on the default list query in `commands/knowledge_graph.rs`. Add "Show superseded (N)" toggle.
10. **Settings UI** — three controls on the knowledge graph settings page.

Each step ends with the targeted check per `AGENTS.md`: `cargo check` for Rust edits, `npx tsc --noEmit` for TS, `npx vitest run` for any touched test file. `./lint.sh` at commit time only.

## Files touched

- `src-tauri/src/schema.sql` — column additions, proposals table.
- `src-tauri/src/db/mod.rs` — append migrations.
- `src-tauri/src/commands/ai_knowledge.rs` — `model_confidence`, rewritten upserts, supersede pass, job-id threading.
- `src-tauri/src/commands/knowledge_graph.rs` — list queries gain `superseded_by IS NULL`; new commands for undo + proposals.
- `src-tauri/src/lib.rs` — register new commands in `tauri::generate_handler![…]` (per `AGENTS.md` rule 6).
- `src/lib/api.ts` — typed wrappers for new commands.
- `src/views/KnowledgeGraphView.tsx` (and settings view) — toggle, badge, undo button, three settings controls.
- `src/tests/` — focused vitest regression for the suggest-mode badge and the undo button.

## Open questions

- **Confidence source.** Model-name heuristic is fine for v1. Worth asking the model for a self-reported score per concept? Adds tokens, marginal benefit.
- **Field-level revert.** Do we need true history (revisions table) or is "delete created, clear superseded" enough for the first cut?
- **Supersede prompt cost.** The second-pass prompt runs once per chunk. On large workspaces this doubles token cost. Consider batching across chunks or running it once at the end of a full `analyze_workspace_chunked` job instead.
- **Link consolidation.** After a type-upgrade INSERTs a new link row alongside the old, who deletes the old? Simplest: the supersede pass treats stale low-confidence links the same way it treats low-confidence nodes.
