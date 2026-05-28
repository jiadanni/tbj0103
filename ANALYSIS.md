# Performance Bottleneck Analysis

## Findings

1. **Unbounded UNION ALL Sorting in Dashboard Activity**
   - **Location:** `tauri/src-tauri/src/commands/dashboard.rs` (in `get_dashboard_summary`)
   - **Issue:** The `recent_activity` query performs a `UNION ALL` across `project_notes`, `concept_nodes`, `chat_sessions`, and `sources`, and then sorts the *entire* combined result set by `timestamp DESC` before applying `LIMIT 6`. This causes a full table scan and sort across multiple large tables.
   - **Recommendation:** Enclose each `SELECT` branch of the `UNION ALL` in a subquery with its own `ORDER BY updated_at DESC LIMIT 6` to drastically reduce the intermediate result size before the final combine and sort. *(Note: This fix has already been implemented.)*

2. **Full Table Scans during Semantic Search**
   - **Location:** AI content processing and retrieval.
   - **Issue:** Vector search queries can become slow as the number of memory embeddings and source chunks grows, as SQLite vector search without a dedicated index (like `vss0`) requires a full table scan for calculating similarities.
   - **Recommendation:** Consider adding an HNSW or similar index for vector embeddings, or use `sqlite-vss`/`sqlite-vec` extension to speed up vector similarity searches.

3. **String Allocation in `generate_summary`**
   - **Location:** `tauri/src-tauri/src/services/ai_content_generator.rs`
   - **Issue:** `generate_summary` uses `.chars().collect()` and other string allocations. When called frequently or on large texts, this can be slow.
   - **Recommendation:** Try using string slices instead of allocating new `String` instances wherever possible, or limit the length of text processed at one time. Wrap in `spawn_blocking` when used in async context.

4. **Correlated Subqueries on Large Tables (Re-evaluated)**
   - **Location:** `tauri/src-tauri/src/commands/document.rs`, `tauri/src-tauri/src/commands/source.rs`, and `tauri/src-tauri/src/services/quick_search_service.rs`
   - **Issue:** Previously thought to be N+1 bottlenecks.
   - **Correction:** Using a correlated subquery like `(SELECT COUNT(*) FROM source_chunks WHERE source_id = s.id)` is actually faster for single-row lookups (`WHERE id = ?`) or index-supported lookups because it avoids aggregating the *entire* `source_chunks` table before joining. Replacing these with `LEFT JOIN (SELECT source_id, COUNT(*) FROM ... GROUP BY source_id)` introduces a massive performance regression by forcing a full table scan and aggregation.
   - **Recommendation:** Keep the correlated subqueries for queries that filter strongly on the primary table. Ensure that foreign keys (like `source_id` on `source_chunks`, and `session_id` on `messages`) have appropriate indices so the correlated subquery lookup remains `O(log N)`.

5. **Heavy Graph Operations on the Main Thread**
   - **Location:** `tauri/src-tauri/src/services/graph_algorithms.rs`
   - **Issue:** Algorithms like PageRank and Community Detection can be CPU intensive.
   - **Recommendation:** Ensure these are properly dispatched to worker threads via `tokio::task::spawn_blocking` to avoid blocking the Tauri async runtime or the SQLite connection pool for extended periods.

## Next Steps
- Add indices to `source_chunks(source_id)` and `messages(session_id)` if they do not already exist.
- Investigate incorporating vector search extensions for SQLite to speed up similarity searches.
