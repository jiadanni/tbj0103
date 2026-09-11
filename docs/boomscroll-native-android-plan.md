# BoomScroll — Native Android Rewrite Plan

**Audience:** an AI coding agent with no prior knowledge of this repo.
**Goal:** rewrite the existing Tauri/React BoomScroll companion app as a native
Android app (Kotlin + Jetpack Compose), at **feature parity**. No new features.

---

## 0. Context you need before starting

BoomScroll is a **flashcard feed** companion to a desktop app called Aetherium.
It is deliberately dumb: it reads a `.json` deck file exported from the desktop
app and presents the cards as a full-screen, vertically-swiped feed (TikTok-style).

It has **no network calls, no database, no accounts, no AI**. Everything is:
read a JSON file → shuffle → show cards → remember a little state locally.

That is why a native rewrite is tractable. The current implementation is only
**1,621 lines of TypeScript and 16 lines of Rust.** Do not be tempted to scope-creep
into the main Aetherium app — that is ~137,000 lines with 333 IPC commands and
54 SQLite tables and is explicitly **out of scope**.

### Source of truth (read these first)

Existing implementation, at repo path `boomscroll/`:

| File | Lines | What it holds |
|---|---:|---|
| `src/App.tsx` | 882 | All screens, gesture handling, feed state machine |
| `src/lib/deck.ts` | 279 | Deck JSON parsing, shuffle, merge, export |
| `src/lib/difficulty.ts` | 250 | 7 difficulty presets + color mapping |
| `src/components/FeedCard.tsx` | 131 | The full-screen card UI |
| `src/lib/quarantine.ts` | 68 | "Banished" cards, persisted per deck |
| `public/demo.json` | — | 64-card built-in demo deck (**reuse as-is**) |

**Read all six before writing code.** The plan below describes behavior, but the
existing code is the authority on edge cases.

### What "native" buys us here

The current app already ships to Android via Tauri (`src-tauri/gen/android`,
package `com.aetherium.boomscroll`). The rewrite is about removing the WebView:
faster cold start, true native scroll/fling physics, and proper system
integration (share-sheet deck import, per-app theming). **Feature set does not
change.**

**Install size is the headline problem.** The installed Tauri build measures
**480 MB app size / 485 MB total** on a real device (Android Settings →
Storage), for an app whose entire payload is 1,621 lines of TypeScript and a
64-card JSON deck. A Compose rewrite of this app should land in the **5–15 MB**
range.

Before writing any code, spend thirty minutes confirming *why* it is 480 MB —
the answer changes how much credit the rewrite deserves:

```bash
cd boomscroll
npm run tauri android build            # release
find src-tauri/gen/android -name '*.apk' -exec ls -lh {} +
unzip -l <the.apk> | sort -k1 -rn | head -20     # biggest entries
```

The near-certain cause is **unstripped Rust debug symbols across four ABIs**:
the `cargo` debug profile keeps full DWARF symbols in `libapp.so`, and the
default Android build packs `arm64-v8a`, `armeabi-v7a`, `x86` and `x86_64`.

- If the **release** APK is also ~480 MB, that is a packaging bug. Record the
  cause here — the rewrite fixes it incidentally, and it is the single
  strongest argument for this work.
- If the release APK is already ~15 MB, then 480 MB was only the debug build.
  Say so plainly in this document and **do not cite size as a reason for the
  rewrite** — the cold-start, gesture-feel and share-sheet arguments still
  stand on their own.

Either way, measure the new APK at cutover (§8) and record the before/after.

---

## 1. Target stack

- **Language:** Kotlin (latest stable), JDK 17
- **UI:** Jetpack Compose + Material 3
- **Architecture:** single-Activity, `ViewModel` + `StateFlow`. No Hilt/Dagger —
  the app is too small; use manual construction or a single `AppContainer`.
- **Persistence:** Jetpack **DataStore (Preferences)** for settings and the
  active deck; see §4. Do **not** add Room — there is no relational data.
- **JSON:** `kotlinx.serialization`.
- **minSdk 26, targetSdk 35** (match or exceed whatever `src-tauri/gen/android`
  currently sets; check `app/build.gradle.kts` before choosing).
- **Package id:** use `com.aetherium.boomscroll.native` for the rewrite so it can
  be installed **side by side** with the existing Tauri build during the port.
  Renaming to `com.aetherium.boomscroll` is the final cutover step (§8).
- **No new third-party dependencies** beyond the above without a stated reason.

**Directory:** create a new sibling module at repo root: `android/`.
Do **not** modify or delete `boomscroll/` — it stays working until cutover.

---

## 2. The deck file format (the app's only input)

Format id `aetherium.boomscroll.deck`. **Versions 1, 2 and 3 must all parse** —
users have old exports on disk. Parse defensively; a malformed deck must produce
a readable error message, never a crash.

```json
{
  "format": "aetherium.boomscroll.deck",
  "version": 3,
  "exported_at": "2026-07-20T11:05:00Z",
  "card_count": 64,
  "workspaces": [
    { "id": "workspace-1", "name": "🧠 AI & Machine Learning",
      "card_count": 8, "preset": "software_engineering" }
  ],
  "cards": [
    { "id": "card-1", "kind": "flashcard",
      "front": "What does Q, K, V stand for in attention?",
      "back": "Query, Key, Value — …",
      "topic": "Attention Mechanism",
      "workspace_id": "workspace-1",
      "difficulty": 3,
      "difficulty_preset": "software_engineering",
      "difficulty_label": "Intermediate" }
  ]
}
```

Version differences:
- **v1** — a single `workspace` object instead of a `workspaces` array; cards have no `workspace_id`.
- **v2** — `workspaces` array; cards carry `workspace_id`.
- **v3** — adds per-workspace `preset`, and per-card `difficulty`, `difficulty_preset`, `difficulty_label`.

**Normalization rule:** every parsed card must resolve a non-null
`workspaceName`, whatever the version, so the card UI can always show its origin.
For v1, that name comes from the single `workspace` object.

**Error strings** (keep them, they are user-facing):
- not valid JSON → `"That file isn't valid JSON."`
- wrong/missing `format` → `"That file isn't a Boom Scroll deck."`
- unsupported version → `"This deck uses format version N, but this app only supports versions 1, 2, 3. Update the app."`
- no `cards` array → `"This deck has no cards array."`

### Domain model (Kotlin)

```kotlin
data class DeckCard(
    val id: String,
    val kind: String,              // "info" => study card; anything else => test card
    val front: String,
    val back: String,
    val topic: String?,
    val workspaceId: String,
    val workspaceName: String,     // always resolved, never null
    val difficulty: Int? = null,   // 1..5
    val difficultyPreset: String? = null,
    val difficultyLabel: String? = null,
)

data class DeckWorkspace(
    val id: String, val name: String, val cardCount: Int, val preset: String? = null,
)

data class Deck(
    val title: String, val workspaces: List<DeckWorkspace>, val cards: List<DeckCard>,
)
```

---

## 3. Behavior spec (port these exactly)

### 3.1 Feed mechanics

- One card fills the screen. **Swipe up** → next card. The feed is **infinite**:
  past the last card it reshuffles and continues.
- **Reshuffle-avoiding-repeat:** when a round ends, the first card of the new
  round must not be the card just shown (only enforced when the deck has >1 card).
  Current code pre-computes this reshuffle while the user sits on the last card
  so the drag preview shows the correct upcoming card — reproduce that, or use
  a Compose pager whose next page is already resolved.
- **Shuffle:** Fisher–Yates, fresh order every time the feed (re)starts.
- Gesture constants from the web build (`App.tsx`), to be treated as *intent*,
  not literal values — retune to native feel:
  - commit threshold `80px`, rubber-band max `30px` (downward drag resists),
    tap slop `10px`.
- **Downward** swipes rubber-band and snap back — there is no "previous card".
- **Tap** (movement under slop): in **test** mode toggles the answer; in **study**
  mode does nothing (study cards always show their body).

> **Native note:** the cleanest Compose expression of this is a vertical
> `VerticalPager` with `beyondBoundsPageCount = 1`. If pager fling physics
> can't reproduce the "no going back" + infinite-reshuffle behavior cleanly,
> fall back to a custom `draggable` + `animateTo`, mirroring App.tsx. Decide
> early — it affects the whole feed screen.

### 3.2 Two modes

- **Study mode** — shows only cards with `kind == "info"` (long-form
  explanations). Body always visible, gets most of the screen.
- **Test mode** — shows only cards with `kind != "info"` (Q&A flashcards).
  Answer hidden until tapped, capped to ~35% of screen height, scrollable.
- **Fallback:** if filtering for a mode yields zero cards, show *all* cards
  rather than an empty feed.
- Switching mode restarts the feed.

### 3.3 Reveal preference

`Show answer immediately` toggle. When on, each new card arrives already
revealed. Toggling it applies to the card currently on screen too. Persisted.

### 3.4 Filters

- **Workspace filter** — multi-select over the deck's workspaces. If a freshly
  loaded deck has >1 workspace and no saved selection, open the filter screen
  first instead of starting the feed.
- **Difficulty filter** — multi-select over levels 1–5. Cards with no
  `difficulty` value are **never** filtered out.

### 3.5 Banish / quarantine (reversible, never a delete)

- Each card has a **Banish** button. Banishing removes it from the running feed
  and records `{cardId: {at: <ISO timestamp>}}`.
- Critical detail: on banish, drop the card from the order and **leave the index
  where it is** so the following card slides into the slot. Advancing the index
  would skip a card.
- If banishing empties the feed, open the filter screen.
- A **Banished** review screen lists banished cards (ordered by timestamp) and
  restores one or many. Restoring restarts the feed.
- **Scoping:** the record is stored per deck under a `deckKey` = the deck's
  workspace ids, sorted, joined with `|`. This survives re-exports of the same
  deck and prevents one deck's banish list from affecting another's.
- Storage must be **failure-tolerant**: corrupt or unreadable data degrades to
  "nothing banished" and never breaks the feed.

### 3.6 Loading a deck

- **Open deck** → system file picker (`ACTION_OPEN_DOCUMENT`, MIME
  `application/json`). Read via `ContentResolver`; do **not** assume a real path.
- **Try demo deck** → loads the bundled 64-card deck. Ship `demo.json` from
  `boomscroll/public/demo.json` as an Android **asset**, unchanged.
- **Merge vs Replace:** loading a deck while one is already open must prompt.
  - *Replace* — discard current, load incoming.
  - *Merge* — union workspaces by id (incoming name/preset wins when non-empty);
    union cards de-duplicated **both** by card id **and** by content key
    `workspaceId:front.trim():back.trim()`. Recompute each workspace's card
    count. Title becomes the single workspace's name, or `"N workspaces"`.
  - After a merge the `deckKey` changes, so the banish record must be **carried
    across** to the new key (existing entries win over incoming ones).
- **Close deck** clears in-memory state and the saved active deck, but
  **leaves the per-deck banish record on disk** so reopening restores it.
- **Android extra (in scope, low cost):** register an intent filter so a
  `.json` deck can be opened from a file manager or the share sheet. This is the
  one place the native build should beat the Tauri build, and it is a natural fit.

### 3.7 Difficulty presets

`difficulty.ts` defines **7 presets**, each mapping levels 1–5 to a label and a
description: `software_engineering` (default), `academic_k12_higher_ed`,
`medical_clinical`, `aviation_aerospace`, `legal_jurisprudence`,
`economics_geopolitics`, `standard_5_star`.

**Port this file verbatim** — it is pure data, translate it literally to Kotlin.
Do not paraphrase, reword, or "improve" the labels and descriptions.

**Resolution order for which preset labels a card** (most specific wins):
1. the card's own `difficulty_preset`, if this build knows it;
2. the user's selected preset, if known;
3. `software_engineering`.

This is deliberate — a deck spanning Music Theory and Roman Empire labels each
card from its own workspace's domain rather than one global setting.

**Level colors** (1→5): emerald, sky, amber, orange, rose. In the web build these
are dark-theme Tailwind classes; define them as Compose `Color` constants in one
place and keep the same hue progression.

If a card carries a non-empty `difficulty_label`, it overrides the preset label.
A missing/out-of-range score normalizes to 3.

---

## 4. Persistence map

Web build uses `localStorage`. Port each key to DataStore. Note the active deck
is stored as **raw JSON text**, which keeps restore trivially correct.

| Web key | Holds | Native |
|---|---|---|
| `boomscroll_active_deck` | raw deck JSON | DataStore string (see note) |
| `boomscroll_enabled_ids` | enabled workspace ids | DataStore string set |
| `boomscroll_active_preset` | selected preset id | DataStore string |
| `boomscroll_show_answer_immediately` | `"1"`/`"0"` | DataStore boolean |
| `boomscroll_quarantine` | `{deckKey: {cardId: {at}}}` | see below |

**Two deviations from a literal port, both justified:**
1. A full deck's JSON can be large. Write the active deck to a **file in
   `filesDir`** (e.g. `active_deck.json`) and keep only a pointer in DataStore.
   DataStore is not meant for large blobs.
2. Store the quarantine map as its own serialized JSON file, keyed by `deckKey`,
   for the same reason.

Difficulty filter selection is **not** persisted in the web build. Match that
(don't add persistence) unless you flag it as a deliberate change.

---

## 5. Screens

1. **Loader / empty state** — title, one-paragraph explainer, `Open deck` and
   `Try demo deck` buttons, inline error text.
2. **Filter** — workspace toggles (with card counts), difficulty toggles,
   preset selector, `Show answer immediately` toggle, Study/Test mode switch,
   Start/Apply, and entries to Banished review + Close deck.
3. **Feed** — the swipeable card stack. Card shows: workspace chip, optional
   topic chip, optional difficulty chip (`L{n} • {label}` with its color dot),
   front text, and either the body/answer panel or a "Tap to reveal answer" hint.
   Plus the Banish button and a "Swipe up for next card" hint.
4. **Banished review** — list + restore.

Visual target: dark theme, near-black background (`zinc-950`), rounded pill
chips, generous spacing, centered text, edge-to-edge with proper insets
(the web build uses `viewport-fit=cover` and safe-area vars — the native
equivalent is `enableEdgeToEdge()` + `WindowInsets`).

Keep it recognizably the same app. Use Material 3 components where they fit, but
don't let stock M3 styling override the existing dark, chip-heavy look.

---

## 6. Suggested file layout

```
android/app/src/main/java/com/aetherium/boomscroll/
├── MainActivity.kt
├── data/
│   ├── DeckParser.kt        // v1/v2/v3 → Deck, with the exact error strings
│   ├── DeckOps.kt           // shuffle, reshuffleAvoidingRepeat, mergeDecks, deckKey
│   ├── Difficulty.kt        // the 7 presets, resolvePresetId, colors, formatLabel
│   ├── DeckStore.kt         // active deck file + DataStore prefs
│   └── QuarantineStore.kt   // per-deckKey banish records
├── model/Models.kt
├── ui/
│   ├── LoaderScreen.kt
│   ├── FilterScreen.kt
│   ├── FeedScreen.kt
│   ├── FeedCard.kt
│   ├── BanishedScreen.kt
│   └── theme/
└── FeedViewModel.kt         // all feed state: order, index, revealed, mode
```

---

## 7. Build order

Work in these steps; each ends in a compiling, runnable app.

1. **Scaffold** — `android/` module, Compose + M3, dark theme, edge-to-edge,
   `MainActivity` showing a placeholder. Confirm it builds and installs.
2. **Model + parser** — `Models.kt`, `DeckParser.kt`, `DeckOps.kt`. Pure Kotlin,
   no UI. **Unit-test this step before moving on** (§9) — everything rests on it.
3. **Difficulty presets** — literal port of `difficulty.ts` + a color mapping.
4. **Loader screen** — demo deck from assets, then the SAF file picker. At this
   point you can load a real deck and log the parsed card count.
5. **Feed screen** — the card composable, then the swipe gesture, then infinite
   reshuffle. Get study mode working before test mode's reveal logic.
6. **Filters** — workspace + difficulty + preset + mode switch + reveal pref.
7. **Persistence** — DataStore + deck file; verify state survives a cold start.
8. **Banish + review screen** — including the index-stays-put rule and the
   merge-carries-the-record rule.
9. **Merge/Replace prompt** — the last piece; it depends on 7 and 8.
10. **Polish** — intent filter for `.json`, app icon, insets, empty/error states.

---

## 8. Cutover

Only after step 10 verifies against the checklist in §9:
1. Change the package id to `com.aetherium.boomscroll`.
2. Confirm the deck format still round-trips with a desktop export.
3. **Measure the release APK and the on-device install size** (Settings →
   Storage, the same screen that produced the 480 MB figure in §0) and record
   the before/after in the cutover commit message.
4. Remove `boomscroll/` in a **separate commit** from the rewrite, so the
   deletion is reviewable on its own and easy to revert.

Until then the two apps coexist.

---

## 9. Definition of done

**Unit tests** (required — these are pure logic and cheap to cover):
- parses v1, v2, v3 decks; resolves `workspaceName` in all three
- each of the four error strings, exactly
- `deckKey` is order-independent and stable
- `mergeDecks` de-dupes by id *and* by content key; recomputes counts
- `reshuffleAvoidingRepeat` never repeats the last card (loop it ~1000×)
- `resolvePresetId` precedence: card preset → user preset → default
- quarantine store returns empty on corrupt input instead of throwing

**Manual checklist on a real device:**
- [ ] demo deck loads and swipes smoothly at 60fps
- [ ] feed loops forever; no immediate repeat at the loop boundary
- [ ] study vs test mode show the right cards; mode with zero matches falls back to all
- [ ] tap reveals in test mode only; "show immediately" applies to the on-screen card
- [ ] workspace + difficulty filters apply; undifficultied cards never filtered out
- [ ] banish removes the card without skipping the next one
- [ ] banished cards restore; record survives close + reopen of the same deck
- [ ] merge carries the banish record to the merged deck
- [ ] state survives force-quit and cold start
- [ ] a `.json` deck opens from the file manager via the share sheet
- [ ] correct insets on a notched device; no content under the status/nav bars

**Explicitly out of scope:** accounts, sync, network, editing cards, SM-2
scheduling, anything from the main Aetherium app.

---

## 10. Rules for the implementing agent

- **Port behavior, don't redesign it.** Where this document and the existing
  TypeScript disagree, the TypeScript wins — say so and flag the discrepancy.
- The comments in `deck.ts`, `quarantine.ts` and `difficulty.ts` explain *why*
  several non-obvious rules exist. Read them; preserve the reasoning.
- Do not touch `tauri/`, `swift/`, or the root `lint.sh` — `lint.sh` does not
  cover this module, and the new `android/` module must not be added to it
  without being asked.
- Build and run after each step in §7. A step is not done because it compiles;
  it is done when the behavior is visible on a device or covered by a test.
- Commit per step in §7, using Conventional Commits (`feat:`, `fix:`, `chore:`).
