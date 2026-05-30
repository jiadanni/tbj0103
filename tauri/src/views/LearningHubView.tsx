/**
 * LearningHubView — consolidates the legacy `/graph` (Knowledge), `/flashcards`
 * (Review), and `/learning` (Goals) routes into a single surface with three tabs
 * sharing the `concept_nodes` tree as the spine. The legacy routes redirect here
 * with a `?tab=` query param so existing bookmarks keep working.
 *
 * Layout: persistent shared concept tree sidebar on the left controls
 * `selectedConceptId`, which feeds into each tab's pane:
 *   - Roadmap pane focuses the corresponding concept in its detail panel
 *   - Review pane filters cards to `source_id = <concept>`
 *   - Goals pane currently ignores it (no concept_id column yet)
 */
import { useEffect, useState, useMemo, lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { GraduationCap, Map, Target } from "lucide-react";
import LearningHubSidebar from "../components/LearningHubSidebar";
import { useWorkspaceStore } from "../stores/workspaceStore";

// Lazy-load each pane so its heavy deps (d3, CodeMirror, etc.) only ship when
// the matching tab is first opened. `React.lazy` needs a default export, so we
// adapt each named pane alias via `.then`.
const ReviewPane = lazy(() =>
  import("./FlashcardReviewView").then((m) => ({ default: m.ReviewPane })),
);
const RoadmapPane = lazy(() =>
  import("./KnowledgeGraphView").then((m) => ({ default: m.RoadmapPane })),
);
const GoalsPane = lazy(() =>
  import("./LearningPathView").then((m) => ({ default: m.GoalsPane })),
);

type HubTab = "roadmap" | "review" | "goals";

const TABS: { id: HubTab; label: string; Icon: typeof Map }[] = [
  { id: "roadmap", label: "Roadmap", Icon: Map },
  { id: "review", label: "Review", Icon: GraduationCap },
  { id: "goals", label: "Goals", Icon: Target },
];

function parseTab(value: string | null): HubTab {
  if (value === "roadmap" || value === "review" || value === "goals") {
    return value;
  }
  return "roadmap";
}

export default function LearningHubView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = useMemo(() => parseTab(searchParams.get("tab")), [searchParams]);
  const [activeTab, setActiveTab] = useState<HubTab>(initialTab);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const { activeWorkspaceId } = useWorkspaceStore();

  // Keep the URL in sync so tab state is bookmarkable and shareable.
  useEffect(() => {
    const current = parseTab(searchParams.get("tab"));
    if (current !== activeTab) {
      const next = new URLSearchParams(searchParams);
      next.set("tab", activeTab);
      setSearchParams(next, { replace: true });
    }
  }, [activeTab, searchParams, setSearchParams]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tab bar — pattern lifted from PreferencesView. */}
      <div className="flex gap-1.5 overflow-x-auto border-b border-[var(--border-color)] bg-[var(--bg-elevated)] px-4 pt-2">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 whitespace-nowrap px-3.5 py-2.5 text-sm rounded-t-lg border-b-2 transition-colors ${
              activeTab === id
                ? "border-[var(--accent-color)] text-[var(--accent-color)] font-medium"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <LearningHubSidebar
          workspaceId={activeWorkspaceId}
          selectedConceptId={selectedConceptId}
          onSelect={setSelectedConceptId}
        />
        <div className="flex-1 min-w-0 overflow-hidden">
          <Suspense fallback={<div className="p-4 text-sm text-[var(--text-muted)]">Loading…</div>}>
            {activeTab === "roadmap" && (
              <RoadmapPane hideSidebar selectedConceptId={selectedConceptId} />
            )}
            {activeTab === "review" && (
              <ReviewPane hideSidebar conceptId={selectedConceptId} />
            )}
            {activeTab === "goals" && (
              <GoalsPane
                conceptId={selectedConceptId}
                onClearConceptFilter={() => setSelectedConceptId(null)}
              />
            )}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
