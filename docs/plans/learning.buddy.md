  Plan: Learning Buddy

  Status: Draft — iterating before any code is written.

  ---

  ## Vision

  An AI-powered learning companion embedded in the dashboard that proactively
  surfaces what to study next, shaped by who the user actually is (profile),
  what they're genuinely trying to achieve (active goals vs curiosity), and
  what their study data actually shows (retention, quiz scores, session
  frequency). It speaks first — the user doesn't have to ask.

  The buddy is NOT a chat bot. It lives on the dashboard, generates a
  personalised nudge using Ollama, and offers 1-2 direct action buttons.
  Clicking a button launches a quiz, opens flashcard review, or navigates
  to a goal — no chat required.

  ---

  ## Open questions (resolve before coding)

  1. Should the buddy nudge re-generate on every dashboard load, or only once
     per session / on a time-based TTL? (Proposed: 4-hour TTL cached in
     settings table — but discuss whether "stale" cached nudge is worse than
     no nudge.)

  2. What happens when Ollama is not running? The buddy should degrade to a
     deterministic template nudge (no blank panel), but should it make that
     visible to the user or stay silent about the fallback?

  3. For the curiosity/active distinction: should it be primarily on the
     *workspace* (intent field), the *goal* (intent field), or the *profile*
     (curiosity_topics text)? Currently proposed: all three with different
     granularity. Confirm this is not redundant.

  4. Parent-chain inheritance: if a child workspace has an empty profile, it
     inherits the parent's. But what if the child workspace is a different
     subject entirely (e.g., parent = "Engineering", child = "Spanish
     Language")? A blanket career goal about engineering would feel wrong in
     the Spanish workspace. Consider whether the buddy prompt should include
     parent context at all, or only include it when the child workspace has
     no career_goal of its own.

  5. Goal categories live on individual goals AND as priority areas in the
     profile. Is that duplication or complementary? Proposed interpretation:
     profile categories = "areas I care about right now"; goal category =
     "what this specific goal belongs to". The buddy filters overdue signals
     by the intersection of both.

  6. How does sub-workspace content bubble up to a parent dashboard? If a user
     is viewing the root workspace dashboard, should it show overdue signals
     from all child workspaces? Or only from the current workspace? (Dashboard
     already has an `includeDescendants` flag — lean on that.)

  ---

  ## Scope: what changes

  ### Layer 1 — Data model (profile + schema)

  #### 1a. AboutYouProfile — new fields

  Additive to existing struct on both sides (Rust + TS). All fields use
  #[serde(default)] / optional parsing so existing stored JSON deserialises
  without issue.

  Career context group:
    current_role       String   Text input. Replaces thin `profession` field as
                                the primary label. `profession` kept for compat.
    responsibilities   String   Textarea (3 rows). What they actually do daily.
    career_goal        String   Textarea. Where they're heading professionally.
    career_timeline    String   Dropdown: near_term (6 mo) | medium_term (1-2 yr)
                                | long_term (3-5 yr) | open_ended

  Goal priority areas (multi-select, stored as JSON array):
    active_goal_categories  String  JSON array of strings. Values: professional,
                                    academic, financial, health, spiritual,
                                    creative. Buddy prioritises nudges in these
                                    categories. If empty, all categories treated
                                    equally.

  Curiosity boundary (hard exclusion from review pressure):
    curiosity_topics   String   Textarea. Topics the user is exploring out of
                                interest only. Matched (fuzzy/substring) against
                                topic labels before generating review nudges.
                                Matched topics are excluded from overdue signals.

  Learning behaviour preferences (for shaping nudge tone + action):
    quiz_format_preference     String  Dropdown: flashcards | open_ended |
                                       multiple_choice | mixed
    session_length_preference  String  Dropdown: micro (5 min) | short (15 min)
                                       | medium (30 min) | deep (60+ min)
    nudge_style                String  Dropdown: direct | socratic | encouraging
    learning_pace              String  Dropdown: intensive | steady | relaxed
    recall_mode                String  Dropdown: active_recall | spaced_review
                                       | both

  format_about_you (Rust) gets new rendered lines for career context fields.
  curiosity_topics and learning behaviour fields are NOT rendered into the
  generic about-you block — they feed only the buddy nudge prompt separately,
  to avoid polluting general chat context with scheduling metadata.

  Files:
    src-tauri/src/services/about_you.rs
    src/lib/aboutYou.ts
    src/views/PreferencesView.tsx  (new "Learning Preferences" subsection
                                    inside AboutYouPreferencesPanel)

  #### 1b. learning_goals — category + intent columns

  Migration (additive, idempotent):
    ALTER TABLE learning_goals ADD COLUMN category TEXT NOT NULL DEFAULT 'professional';
    ALTER TABLE learning_goals ADD COLUMN intent   TEXT NOT NULL DEFAULT 'active';

  category values: professional | academic | financial | health | spiritual
                   | creative | curiosity
  intent values:   active (full nudge pressure) | exploration (no review
                   nudges, appears in "Exploring" section not "Goals in Motion")

  Existing goals default to professional + active — both sensible fallbacks.

  LearningGoal Rust model and TS interface both get the two new fields.
  Dashboard summary query filters `intent = 'active'` goals for overdue
  calculations. Exploration-intent goals still show on the dashboard but in
  a separate visual grouping.

  Files:
    src-tauri/src/schema.sql  (migration block)
    src-tauri/src/models/learning_goal.rs
    src/lib/api.ts
    src/views/LearningPathView.tsx  (category + intent picker on goal form)

  #### 1c. workspaces — intent column

  Migration (additive):
    ALTER TABLE workspaces ADD COLUMN intent TEXT NOT NULL DEFAULT 'active';

  intent values:
    active       Full behaviour. Review nudges, quiz pressure, flashcard
                 overdue signals all generated from this workspace's content.
    exploration  Curiosity mode. Buddy surfaces interesting connections but
                 never reports content as overdue. No flashcard or quiz nudge
                 generated from this workspace.
    reference    Archive / reference only. Buddy ignores this workspace
                 entirely for nudge generation.

  The workspace intent is a single dropdown added to WorkspaceSettingsView.
  It is also shown as a small badge on the workspace list so the user can
  see at a glance which workspaces are in curiosity / reference mode.

  Files:
    src-tauri/src/schema.sql  (migration block)
    src-tauri/src/commands/workspace.rs  (read/write intent field)
    src/lib/api.ts
    src/views/WorkspaceSettingsView.tsx  (dropdown)

  ---

  ### Layer 2 — Parent-chain profile inheritance

  Current behaviour in resolve_about_you_text:
    1. Check workspace's own about_you
    2. Fall back to global settings

  New behaviour — walk parent_workspace_id chain up to depth 5 (cycle-safe):
    1. Check workspace's own about_you (if non-empty, use it)
    2. Check parent workspace's about_you
    3. Check grandparent's about_you
    ... up to depth 5
    4. Fall back to global settings

  First non-empty profile wins. This means a user can set career context at
  the root workspace level and all child workspaces inherit it automatically.

  Edge case: the buddy prompt should include parent context only when the
  child workspace has no career_goal of its own. A child workspace on a
  completely unrelated topic shouldn't have its nudges framed around the
  parent's engineering career goal. Proposed: the buddy query fetches the
  effective profile AND checks if career_goal came from the workspace itself
  or from a parent; if from a parent, it is included in the nudge prompt with
  lower weight ("broader context: ...") rather than as the primary frame.

  This requires resolve_about_you_text to return a provenance flag alongside
  the profile text, or a new resolve_about_you_profile function that returns
  the full struct plus a source enum (Own | Parent(n) | Global).

  Files:
    src-tauri/src/services/about_you.rs  (pure service change, no schema)

  ---

  ### Layer 3 — Behind-the-scenes signals (new Rust queries)

  Two new commands that feed the buddy nudge generator. Neither is called
  from the dashboard directly — they are called from within the
  generate_buddy_nudge command only.

  #### 3a. get_topic_retention_summary (internal, not a public command)

  Per topic: aggregate the SM-2 forgetting curve (e^(-t/S)) across all cards.
  Already implemented as retention_score() in spaced_repetition.rs.

  Returns Vec<TopicRetention>:
    topic_id             String
    topic_label          String
    avg_retention        f64     0–1. Lower = more forgetting.
    weakest_card_front   String  For surfacing in the nudge message.
    due_card_count       i64
    days_since_any_review i64    NULL treated as very large (never reviewed).

  Query: JOIN flashcard_topics + learning_cards, compute
  (julianday('now') - julianday(last_reviewed_at)) / interval per card,
  then aggregate per topic. Filter out cards from workspaces with
  intent IN ('exploration', 'reference').

  Also filters out topics whose label fuzzy-matches curiosity_topics from
  the user profile (simple LOWER(topic) LIKE '%term%' for each term in the
  comma-separated curiosity_topics string).

  #### 3b. get_learning_activity_stats (internal, not a public command)

  Behavioural patterns from actual usage:
    sessions_per_week    f64    7-day rolling average of distinct review/chat
                                activity dates (from chat_messages.created_at
                                and learning_cards.last_reviewed_at combined)
    quiz_success_rate    f64    AVG(quiz_answers.score) over last 30 days,
                                only for quizzes in active-intent workspaces
    streak_days          i64    Consecutive days with any study activity
    most_active_hour     i64    Mode of strftime('%H', created_at) from
                                chat_messages — used to personalise timing
                                ("you tend to study in the evenings")
    sessions_this_week   i64    Raw count for "below your usual N" comparison

  These signals are not for display. They feed the Ollama prompt so the
  buddy can notice patterns ("you've only had 1 session this week, usually
  you do 3") without the user having to tell it anything.

  ---

  ### Layer 4 — AI-generated buddy nudge

  #### New command: generate_buddy_nudge

  Signature:
    pub async fn generate_buddy_nudge(
        state: State<DbState>,
        workspace_id: String,
        force_refresh: bool,
    ) -> Result<BuddyNudge, String>

  Return type:
    struct BuddyNudge {
        message:                String,   Warm, personalised 1-2 sentence nudge
        question:               String,   Follow-up question to the user
        primary_action_label:   String,   e.g. "Test me on Bayesian inference"
        primary_action_route:   String,   e.g. "/learning?tab=quizzes&topic=..."
        secondary_action_label: Option<String>,
        secondary_action_route: Option<String>,
        generated_at:           String,   ISO timestamp
        fallback:               bool,     true if Ollama was unreachable and
                                          a deterministic template was used
    }

  Cache: stored in settings table under key
  `buddy_nudge_cache_{workspace_id}` as JSON. TTL = 4 hours.
  On dashboard load: if cache exists and is < 4 hours old, return it
  immediately. If stale or force_refresh = true, regenerate.

  Fallback (Ollama unreachable): build a deterministic nudge from the same
  signals without calling Ollama. Example:
    message:  "You have 4 flashcards due and haven't studied this week."
    question: "Want to run a quick review?"
  This ensures the panel always shows something useful. fallback = true
  allows the frontend to show a subtle indicator.

  #### Ollama prompt structure

  The prompt passed to Ollama is assembled as follows. Order matters —
  the model should see the task description first, then context, then
  the output format constraint.

    You are a learning companion assistant. Generate a single warm,
    personalised nudge based on the learner's profile and study data.
    Match the nudge_style exactly. Keep message to 1-2 sentences.
    The question should be open-ended and invite engagement.

    Learner profile:
    - Career goal: {career_goal} ({career_timeline})
    - Day-to-day: {responsibilities}
    - Active learning categories: {active_goal_categories}
    - Nudge style: {nudge_style}
    - Session preference: {session_length_preference}
    - Recall mode: {recall_mode}

    Workspace: "{workspace_name}"
    {if parent context}: Part of "{parent_name}" ({parent_career_context})
    Workspace intent: active

    Overdue study signals (curiosity topics and exploration workspaces excluded):
    {for each topic in top 3 by lowest retention}:
    - {topic_label}: {avg_retention}% retention, {days_since_any_review}d since
      review, {due_card_count} cards due
    {end for}

    Active goals needing attention:
    {for each active goal with progress stalled > 14 days}:
    - [{category}] "{title}" — {progress}% complete, last updated {days}d ago
    {end for}

    Behavioural context:
    - Sessions this week: {sessions_this_week} (typical: ~{sessions_per_week}/wk)
    - Recent quiz: {quiz_success_rate*100}% avg score (last 30 days)
    - Study streak: {streak_days} day(s)

    Respond ONLY with valid JSON, no markdown:
    {
      "message": "...",
      "question": "...",
      "primary_action_label": "...",
      "primary_action_route": "...",
      "secondary_action_label": "...",
      "secondary_action_route": "..."
    }

  The routes in the response are constrained to a whitelist defined in
  the Rust command — the model cannot inject arbitrary navigation. The
  command validates that returned routes start with one of:
    /learning, /flashcards, /graph, /chat, /notes

  Files:
    src-tauri/src/commands/buddy.rs  (new file)
    src-tauri/src/lib.rs             (register command)
    src/lib/api.ts                   (invoke wrapper)

  ---

  ### Layer 5 — Dashboard surface

  #### BuddyPanel component

  A new section on FolderDashboardView, rendered between the metrics row
  and the main content grid. Visually distinct from the data sections:
  slightly warmer background, accent-coloured left border, no eyebrow label.

  States:
    loading      Skeleton shimmer while generate_buddy_nudge is in-flight.
                 Shows immediately on first load; subsequent loads show the
                 cached nudge while the new one generates in the background.
    ready        Shows message, question, and up to 2 action buttons.
    fallback     Same as ready but with a subtle "⚡ offline mode" indicator
                 when BuddyNudge.fallback = true.
    dismissed    Collapsed to a single line ("Resume learning — tap to expand")
                 stored in sessionStorage, resets daily.

  Action buttons are full-width on narrow layouts, side-by-side on wide.
  Primary button uses accent colour; secondary uses ghost style.

  Learning style summary line (the "button in about you"):
    Below the action buttons, a small muted line:
    "Learning as: hands-on · 15 min sessions · socratic  [Edit]"
    [Edit] navigates to /preferences#about-you. This keeps the profile
    visible without adding a separate panel, and gives users a frictionless
    path to update their learning style when the nudge feels off.

  #### Exploration goals grouping

  The existing "Goals in Motion" section filters to `intent = 'active'` goals
  only. A new collapsible "Exploring" row (collapsed by default) shows
  `intent = 'exploration'` goals without progress bars or overdue indicators —
  just the title and category tag.

  #### Dashboard search with intent detection

  The existing search bar already routes to /chat on Enter. Intercept two
  patterns in handleSearchSubmit before the navigate call:

    "quiz me on X" / "test me on X"  →  openQuizForTag(X)
    "review flashcards" / "study X"  →  navigate("/learning?tab=flashcards")
    Everything else                  →  existing navigate("/chat", ...) behaviour

  This is a 3-branch check, no NLP, no second model call.

  Files:
    src/views/FolderDashboardView.tsx  (BuddyPanel component, goal grouping,
                                        search intent detection)

  ---

  ## File change summary

  src-tauri/src/schema.sql
    Two migration blocks: learning_goals + workspaces intent columns

  src-tauri/src/services/about_you.rs
    New fields in AboutYouProfile struct
    Updated format_about_you renderer
    Parent-chain walk in resolve_about_you_text (or new sibling function)

  src-tauri/src/models/learning_goal.rs
    category and intent fields

  src-tauri/src/commands/workspace.rs
    Read/write intent field

  src-tauri/src/commands/buddy.rs  (NEW)
    get_topic_retention_summary (private fn)
    get_learning_activity_stats (private fn)
    generate_buddy_nudge (public Tauri command)
    BuddyNudge struct
    Cache read/write helpers
    Deterministic fallback builder

  src-tauri/src/lib.rs
    Register generate_buddy_nudge in generate_handler!

  src/lib/aboutYou.ts
    New fields mirroring Rust struct

  src/lib/api.ts
    invoke wrapper for generate_buddy_nudge
    Updated LearningGoal type (category, intent)
    Updated Workspace type (intent)

  src/views/PreferencesView.tsx
    "Learning Preferences" subsection in AboutYouPreferencesPanel
    New dropdowns for quiz_format_preference, session_length_preference,
    nudge_style, learning_pace, recall_mode
    New inputs for current_role, responsibilities, career_goal, career_timeline
    New textarea for curiosity_topics
    Multi-select for active_goal_categories

  src/views/WorkspaceSettingsView.tsx
    Workspace intent dropdown

  src/views/LearningPathView.tsx
    Category + intent picker on goal create/edit form

  src/views/FolderDashboardView.tsx
    BuddyPanel component (new inner component)
    Exploration goals grouping
    handleSearchSubmit intent detection

  ---

  ## Validation gates (per layer, not per file)

  After Layer 1 (schema + profile):
    cargo check --manifest-path tauri/src-tauri/Cargo.toml → exit 0
    npx tsc --noEmit → exit 0
    Manually: create a goal, set category=spiritual, intent=exploration;
    confirm it appears in Exploring not Goals in Motion.

  After Layer 2 (parent-chain inheritance):
    cargo check → exit 0
    Manual: child workspace with empty about_you, parent with career_goal set;
    confirm child's chat system prompt includes parent's career_goal.

  After Layer 3 + 4 (signals + buddy command):
    cargo check → exit 0
    curl http://localhost:11434/api/tags to confirm Ollama is running
    invoke generate_buddy_nudge from DevTools; confirm non-empty JSON response
    Confirm fallback = true when Ollama is stopped.

  After Layer 5 (dashboard surface):
    npx tsc --noEmit → exit 0
    Visual: BuddyPanel shows in dashboard with message + 2 buttons
    Visual: "Edit" link on learning style line opens preferences at correct tab
    Visual: dismissed state persists within session, resets next day

  Full lint gate (before any PR):
    ./lint.sh → all four checks exit 0

  ---

  ## Risks / notes

  - curiosity_topics matching is currently proposed as substring match
    (LOWER(topic) LIKE '%term%'). This is imprecise — "data" would exclude
    "data structures" even if only "data science" is listed as curiosity.
    Consider comma-splitting the curiosity_topics string and matching whole
    tokens, or accepting the imprecision for v1.

  - The Ollama prompt asks for JSON output. Local models (especially smaller
    ones) sometimes produce malformed JSON. The Rust command must handle
    serde_json parse failure gracefully and fall back to the deterministic
    template rather than returning an error to the frontend.

  - Route validation in the buddy command must be strict. The model returns
    route strings that are used directly in frontend navigation. Whitelist
    enforcement in Rust is mandatory — do not trust the model's output.

  - The 4-hour cache TTL means a user who studies between dashboard loads
    will see a stale nudge until the TTL expires. Consider adding a
    "refresh" trigger: any call to review_flashcard or finalize_quiz could
    invalidate the cache so the next dashboard load gets a fresh nudge.

  - Parent-chain depth limit of 5 prevents infinite loops from orphaned
    parent_workspace_id cycles (which should not exist but have historically
    caused issues in other tools). Confirm the schema's ON DELETE SET NULL
    prevents actual cycles — but keep the depth cap anyway.

  - WorkspaceSurveyModal currently writes survey_data into the workspace row.
    If it also writes about_you, ensure the new fields are not clobbered on
    survey re-submission. Check the survey write path before touching the
    about_you column.