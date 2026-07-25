import { ChevronDown } from "lucide-react";
import { Toggle } from "../Toggle";
import { type NavigationPresentation, useWorkspaceStore } from "../../stores/workspaceStore";
import { useSettingsStore } from "../../stores/settingsStore";

interface NavigationPreferencesPanelProps {
  onPreviewWorkspaceNavigation: (value: NavigationPresentation | null) => void;
  onPreviewSectionNavigation: (value: NavigationPresentation | null) => void;
  onPreviewSubWorkspaceNavigation: (value: NavigationPresentation | null) => void;
  onPreviewWorkspaceSortOrder: (value: string | null) => void;
  onSetSwitchWorkspaceSection: (value: string) => void;
}

const NavPreview = ({ workspaceNav, sectionNav }: { workspaceNav: NavigationPresentation; sectionNav: NavigationPresentation }) => (
  <div className="mb-2 rounded overflow-hidden border border-[var(--border-color)] opacity-70 flex flex-col" style={{ height: 56 }}>
    {/* Workspace top bar */}
    {workspaceNav === "top-tabs" && (
      <div className="flex items-center gap-1 px-1.5 py-1 bg-[var(--bg-secondary)] shrink-0">
        <div className="h-2 w-6 rounded-full bg-[var(--accent-color)] opacity-80" />
        <div className="h-2 w-4 rounded-full bg-[var(--text-muted)] opacity-40" />
        <div className="h-2 w-5 rounded-full bg-[var(--text-muted)] opacity-40" />
      </div>
    )}
    {workspaceNav === "top-dropdown" && (
      <div className="flex items-center gap-1.5 px-1.5 py-1 bg-[var(--bg-secondary)] shrink-0">
        <div className="h-2 w-9 rounded-full bg-[var(--accent-color)] opacity-80" />
        <div className="h-1.5 w-1.5 bg-[var(--text-muted)] opacity-40" style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
      </div>
    )}
    {/* Section top bar (only when workspace is not sidebar) */}
    {workspaceNav !== "sidebar" && sectionNav === "top-tabs" && (
      <div className="flex items-center gap-1 px-1.5 py-0.5 bg-[var(--bg-secondary)]/70 shrink-0">
        <div className="h-1.5 w-5 rounded-full bg-[var(--accent-color)] opacity-70" />
        <div className="h-1.5 w-3 rounded-full bg-[var(--text-muted)] opacity-35" />
        <div className="h-1.5 w-4 rounded-full bg-[var(--text-muted)] opacity-35" />
      </div>
    )}
    {workspaceNav !== "sidebar" && sectionNav === "top-dropdown" && (
      <div className="flex items-center gap-1.5 px-1.5 py-0.5 bg-[var(--bg-secondary)]/70 shrink-0">
        <div className="h-1.5 w-7 rounded-full bg-[var(--accent-color)] opacity-70" />
        <div className="h-1 w-1 bg-[var(--text-muted)] opacity-35" style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
      </div>
    )}
    {/* Body */}
    <div className="flex flex-1 min-h-0">
      {/* Workspace sidebar rail */}
      {workspaceNav === "sidebar" && (
        <div className="flex flex-col gap-1 px-1 pt-1 bg-[var(--bg-secondary)] w-7 shrink-0">
          <div className="h-1.5 w-4 rounded-sm bg-[var(--accent-color)] opacity-80" />
          <div className="h-1.5 w-3 rounded-sm bg-[var(--text-muted)] opacity-40" />
          <div className="h-1.5 w-4 rounded-sm bg-[var(--text-muted)] opacity-40" />
        </div>
      )}
      {/* Section sidebar rail (inside body) */}
      {sectionNav === "sidebar" && (
        <div className="flex flex-col gap-1 px-1 pt-1 bg-[var(--bg-secondary)]/60 w-6 shrink-0">
          <div className="h-1.5 w-3 rounded-sm bg-[var(--accent-color)] opacity-70" />
          <div className="h-1.5 w-3 rounded-sm bg-[var(--text-muted)] opacity-35" />
          <div className="h-1.5 w-3 rounded-sm bg-[var(--text-muted)] opacity-35" />
        </div>
      )}
      {/* Section top bars when workspace is sidebar */}
      {workspaceNav === "sidebar" && sectionNav === "top-tabs" && (
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex items-center gap-1 px-1.5 py-0.5 bg-[var(--bg-secondary)]/70 shrink-0">
            <div className="h-1.5 w-5 rounded-full bg-[var(--accent-color)] opacity-70" />
            <div className="h-1.5 w-3 rounded-full bg-[var(--text-muted)] opacity-35" />
            <div className="h-1.5 w-4 rounded-full bg-[var(--text-muted)] opacity-35" />
          </div>
          <div className="flex-1 px-1.5 pt-1 flex flex-col gap-1 bg-[var(--bg-primary)]">
            <div className="h-1.5 w-8 rounded-sm bg-[var(--text-muted)] opacity-25" />
            <div className="h-1.5 w-6 rounded-sm bg-[var(--text-muted)] opacity-15" />
          </div>
        </div>
      )}
      {workspaceNav === "sidebar" && sectionNav === "top-dropdown" && (
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex items-center gap-1.5 px-1.5 py-0.5 bg-[var(--bg-secondary)]/70 shrink-0">
            <div className="h-1.5 w-7 rounded-full bg-[var(--accent-color)] opacity-70" />
            <div className="h-1 w-1 bg-[var(--text-muted)] opacity-35" style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
          </div>
          <div className="flex-1 px-1.5 pt-1 flex flex-col gap-1 bg-[var(--bg-primary)]">
            <div className="h-1.5 w-8 rounded-sm bg-[var(--text-muted)] opacity-25" />
            <div className="h-1.5 w-6 rounded-sm bg-[var(--text-muted)] opacity-15" />
          </div>
        </div>
      )}
      {/* Content area (default — no special section handling needed) */}
      {!(workspaceNav === "sidebar" && sectionNav !== "sidebar") && (
        <div className="flex-1 px-1.5 pt-1 flex flex-col gap-1 bg-[var(--bg-primary)]">
          <div className="h-1.5 w-8 rounded-sm bg-[var(--text-muted)] opacity-25" />
          <div className="h-1.5 w-6 rounded-sm bg-[var(--text-muted)] opacity-15" />
        </div>
      )}
    </div>
  </div>
);

// Dedicated thumbnail for the sub-workspace navigation picker. Sub-workspaces
// are children of the active parent, so the frame always shows a parent
// workspace tab row, then the chosen sub-workspace presentation.
const SubNavPreview = ({ subNav }: { subNav: NavigationPresentation }) => (
  <div className="mb-2 rounded overflow-hidden border border-[var(--border-color)] opacity-70 flex flex-col" style={{ height: 56 }}>
    {/* Parent workspace top bar (constant) */}
    <div className="flex items-center gap-1 px-1.5 py-1 bg-[var(--bg-secondary)] shrink-0">
      <div className="h-2 w-6 rounded-full bg-[var(--accent-color)] opacity-80" />
      <div className="h-2 w-4 rounded-full bg-[var(--text-muted)] opacity-40" />
    </div>
    {/* Sub-workspace tab row */}
    {subNav === "top-tabs" && (
      <div className="flex items-center gap-1 px-1.5 py-0.5 bg-[var(--bg-secondary)]/70 shrink-0">
        <div className="h-1.5 w-1.5 rounded-full bg-[var(--text-muted)] opacity-40" />
        <div className="h-1.5 w-4 rounded-full bg-[var(--accent-color)] opacity-70" />
        <div className="h-1.5 w-3 rounded-full bg-[var(--text-muted)] opacity-35" />
      </div>
    )}
    {/* Sub-workspace dropdown row */}
    {subNav === "top-dropdown" && (
      <div className="flex items-center gap-1.5 px-1.5 py-0.5 bg-[var(--bg-secondary)]/70 shrink-0">
        <div className="h-1.5 w-6 rounded-full bg-[var(--accent-color)] opacity-70" />
        <div className="h-1 w-1 bg-[var(--text-muted)] opacity-35" style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
      </div>
    )}
    {/* Body */}
    <div className="flex flex-1 min-h-0">
      {/* Sub-workspace sidebar rail */}
      {subNav === "sidebar" && (
        <div className="flex flex-col gap-1 px-1 pt-1 bg-[var(--bg-secondary)]/60 w-7 shrink-0">
          <div className="h-1.5 w-3 rounded-sm bg-[var(--text-muted)] opacity-35" />
          <div className="h-1.5 w-4 rounded-sm bg-[var(--accent-color)] opacity-70" />
          <div className="h-1.5 w-3 rounded-sm bg-[var(--text-muted)] opacity-35" />
        </div>
      )}
      <div className="flex-1 px-1.5 pt-1 flex flex-col gap-1 bg-[var(--bg-primary)]">
        <div className="h-1.5 w-8 rounded-sm bg-[var(--text-muted)] opacity-25" />
        <div className="h-1.5 w-6 rounded-sm bg-[var(--text-muted)] opacity-15" />
      </div>
    </div>
  </div>
);

export function NavigationPreferencesPanel({
  onPreviewWorkspaceNavigation,
  onPreviewSectionNavigation,
  onPreviewSubWorkspaceNavigation,
  onPreviewWorkspaceSortOrder,
  onSetSwitchWorkspaceSection,
}: NavigationPreferencesPanelProps) {
  const settingsNavLayout = useSettingsStore((state) => state.settingsNavLayout);
  const setSettingsNavLayout = useSettingsStore((state) => state.setSettingsNavLayout);
  const switchWorkspaceSection = useSettingsStore((state) => state.switchWorkspaceSection);

  const workspaceNavigation = useWorkspaceStore((state) => state.workspaceNavigation);
  const setWorkspaceNavigation = useWorkspaceStore((state) => state.setWorkspaceNavigation);
  const sectionNavigation = useWorkspaceStore((state) => state.sectionNavigation);
  const setSectionNavigation = useWorkspaceStore((state) => state.setSectionNavigation);
  const subWorkspaceNavigation = useWorkspaceStore((state) => state.subWorkspaceNavigation);
  const setSubWorkspaceNavigation = useWorkspaceStore((state) => state.setSubWorkspaceNavigation);
  const workspaceSortOrder = useWorkspaceStore((state) => state.workspaceSortOrder);
  const setWorkspaceSortOrder = useWorkspaceStore((state) => state.setWorkspaceSortOrder);
  const combineWorkspaceDropdown = useWorkspaceStore((state) => state.combineWorkspaceDropdown);
  const setCombineWorkspaceDropdown = useWorkspaceStore((state) => state.setCombineWorkspaceDropdown);
  const combineSubWorkspaceDropdown = useWorkspaceStore((state) => state.combineSubWorkspaceDropdown);
  const setCombineSubWorkspaceDropdown = useWorkspaceStore((state) => state.setCombineSubWorkspaceDropdown);
  const combineSectionDropdown = useWorkspaceStore((state) => state.combineSectionDropdown);
  const setCombineSectionDropdown = useWorkspaceStore((state) => state.setCombineSectionDropdown);

  return (
    <div className="flex flex-col gap-8">
      <section className="space-y-3" data-pref-section>
        <div className="pb-1.5 border-b border-[var(--border-color)]">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Main layout</h3>
          <p className="text-xs text-[var(--text-muted)]/80 mt-1">
            Choose how workspace and section switching is presented in the main window.
          </p>
        </div>

        <div>
          <label className="text-xs text-[var(--text-secondary)] mb-2 block">Workspace Navigation</label>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { id: "sidebar", label: "Sidebar", description: "Keep workspace switching in the left rail beside the main content." },
              { id: "top-tabs", label: "Top Tabs", description: "Show workspaces as visible tabs across the top." },
              { id: "top-dropdown", label: "Top Dropdown", description: "Use a compact workspace picker in the top bar." },
            ].map((option) => (
              <button
                key={option.id}
                onClick={() => setWorkspaceNavigation(option.id as NavigationPresentation)}
                onMouseEnter={() => onPreviewWorkspaceNavigation(option.id as NavigationPresentation)}
                onMouseLeave={() => onPreviewWorkspaceNavigation(null)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${workspaceNavigation === option.id
                  ? "border-[var(--accent-color)] bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                  : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  }`}
              >
                <NavPreview workspaceNav={option.id as NavigationPresentation} sectionNav={sectionNavigation} />
                <div className="text-xs font-medium">{option.label}</div>
                <div className="mt-1 text-[11px] opacity-75">{option.description}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-[var(--text-secondary)] mb-2 block">Section Navigation</label>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { id: "sidebar", label: "Sidebar", description: "Keep section navigation in the left rail." },
              { id: "top-tabs", label: "Top Tabs", description: "Show sections as visible tabs across the top." },
              { id: "top-dropdown", label: "Top Dropdown", description: "Use a compact section picker in the top bar." },
            ].map((option) => (
              <button
                key={option.id}
                onClick={() => setSectionNavigation(option.id as NavigationPresentation)}
                onMouseEnter={() => onPreviewSectionNavigation(option.id as NavigationPresentation)}
                onMouseLeave={() => onPreviewSectionNavigation(null)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${sectionNavigation === option.id
                  ? "border-[var(--accent-color)] bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                  : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  }`}
              >
                <NavPreview workspaceNav={workspaceNavigation} sectionNav={option.id as NavigationPresentation} />
                <div className="text-xs font-medium">{option.label}</div>
                <div className="mt-1 text-[11px] opacity-75">{option.description}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-[var(--text-secondary)] mb-2 block">Sub-Workspace Navigation</label>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { id: "sidebar", label: "Sidebar", description: "List sub-workspaces in a left rail beside the main content." },
              { id: "top-tabs", label: "Top Tabs", description: "Show sub-workspaces as a tab row beneath the titlebar." },
              { id: "top-dropdown", label: "Top Dropdown", description: "Use a compact sub-workspace picker beneath the titlebar." },
            ].map((option) => (
              <button
                key={option.id}
                onClick={() => setSubWorkspaceNavigation(option.id as NavigationPresentation)}
                onMouseEnter={() => onPreviewSubWorkspaceNavigation(option.id as NavigationPresentation)}
                onMouseLeave={() => onPreviewSubWorkspaceNavigation(null)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${subWorkspaceNavigation === option.id
                  ? "border-[var(--accent-color)] bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                  : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  }`}
              >
                <SubNavPreview subNav={option.id as NavigationPresentation} />
                <div className="text-xs font-medium">{option.label}</div>
                <div className="mt-1 text-[11px] opacity-75">{option.description}</div>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[var(--text-muted)]/80">
            Applies when the active workspace has sub-workspaces. Independent of the workspace and section choices above.
          </p>
        </div>

        <div>
          <label className="text-xs text-[var(--text-secondary)] mb-2 block">Combine dropdowns into titlebar line</label>
          <p className="text-[11px] text-[var(--text-muted)]/80 mb-2.5">
            For each axis set to Top Dropdown, place its picker on a single titlebar line (Workspace / Sub-workspace / Section) instead of its own row. Only applies to axes using Top Dropdown.
          </p>
          <div className="space-y-2.5">
            {[
              { id: "workspace", label: "Workspace", on: combineWorkspaceDropdown, toggle: () => setCombineWorkspaceDropdown(!combineWorkspaceDropdown), enabled: workspaceNavigation === "top-dropdown" },
              { id: "subworkspace", label: "Sub-workspace", on: combineSubWorkspaceDropdown, toggle: () => setCombineSubWorkspaceDropdown(!combineSubWorkspaceDropdown), enabled: subWorkspaceNavigation === "top-dropdown" },
              { id: "section", label: "Section", on: combineSectionDropdown, toggle: () => setCombineSectionDropdown(!combineSectionDropdown), enabled: sectionNavigation === "top-dropdown" },
            ].map((row) => (
              <div key={row.id} className={`flex items-start gap-3 py-0.5 ${row.enabled ? "" : "opacity-50"}`}>
                <Toggle on={row.on} onToggle={row.toggle} disabled={!row.enabled} />
                <div>
                  <p className="text-sm text-[var(--text-secondary)]">{row.label}</p>
                  {!row.enabled && (
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">Set {row.label} navigation to Top Dropdown to combine it.</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>


      <section className="space-y-3" data-pref-section>
        <div className="pb-1.5 border-b border-[var(--border-color)]">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Workspace behavior</h3>
          <p className="text-xs text-[var(--text-muted)]/80 mt-1">
            Tune workspace ordering and what happens when you jump between workspaces.
          </p>
        </div>

        <div>
          <label className="text-xs text-[var(--text-secondary)] mb-2 block">Workspace Sort Order</label>
          <div className="grid gap-2 sm:grid-cols-4">
            {([
              { id: "manual", label: "Manual Order" },
              { id: "name-asc", label: "Name A\u2013Z" },
              { id: "name-desc", label: "Name Z\u2013A" },
              { id: "created-newest", label: "Newest First" },
              { id: "created-oldest", label: "Oldest First" },
              { id: "updated-newest", label: "Recently Updated" },
              { id: "last-message-newest", label: "Last Message" },
              { id: "updated-oldest", label: "Least Recently Updated" },
            ] as const).map((option) => (
              <button
                key={option.id}
                onClick={() => setWorkspaceSortOrder(option.id)}
                onMouseEnter={() => onPreviewWorkspaceSortOrder(option.id)}
                onMouseLeave={() => onPreviewWorkspaceSortOrder(null)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${workspaceSortOrder === option.id
                  ? "border-[var(--accent-color)] bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                  : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  }`}
              >
                <div className="text-xs font-medium">{option.label}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm text-[var(--text-secondary)]">Navigate on workspace switch</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Auto-navigate to a section when switching workspaces, or stay on the current view.
            </p>
          </div>
          <div className="relative">
            <select
              value={switchWorkspaceSection}
              onChange={(e) => onSetSwitchWorkspaceSection(e.target.value)}
              className="appearance-none cursor-pointer text-sm bg-[var(--bg-input)] border border-[var(--border-color)] rounded-lg pl-2 pr-7 py-1 text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
            >
              <option value="">Stay on current</option>
              <option value="/folder">Dashboard</option>
              <option value="/chat">Chat</option>
              <option value="/notes">Library</option>
              <option value="/sources">Sources</option>
              <option value="/graph">Knowledge</option>
              <option value="/history">History</option>
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          </div>
        </div>

        <div>
          <label className="text-xs text-[var(--text-secondary)] mb-2 block">Settings Navigation</label>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { id: "top-tabs", label: "Top Tabs", description: "Keep settings sections across the top." },
              { id: "side-tabs", label: "Side Tabs", description: "Keep settings sections in a dedicated side rail." },
            ].map((layout) => (
              <button
                key={layout.id}
                onClick={() => setSettingsNavLayout(layout.id as "top-tabs" | "side-tabs")}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${settingsNavLayout === layout.id
                  ? "border-[var(--accent-color)] bg-[var(--accent-color)]/15 text-[var(--accent-color)]"
                  : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  }`}
              >
                {/* Mini preview — shows what the settings panel will look like */}
                {layout.id === "top-tabs" ? (
                  <div className="mb-2 rounded overflow-hidden border border-[var(--border-color)] opacity-70" style={{ height: 52 }}>
                    {/* Settings header with horizontal tab bar */}
                    <div className="flex items-center gap-1 px-2 py-1.5 bg-[var(--bg-secondary)]">
                      <div className="h-2 w-6 rounded-full bg-[var(--accent-color)] opacity-80" />
                      <div className="h-2 w-4 rounded-full bg-[var(--text-muted)] opacity-40" />
                      <div className="h-2 w-5 rounded-full bg-[var(--text-muted)] opacity-40" />
                      <div className="h-2 w-3 rounded-full bg-[var(--text-muted)] opacity-40" />
                    </div>
                    {/* Content area */}
                    <div className="px-2 pt-1.5 flex flex-col gap-1 bg-[var(--bg-primary)]">
                      <div className="h-1.5 w-12 rounded-sm bg-[var(--text-muted)] opacity-30" />
                      <div className="h-1.5 w-8 rounded-sm bg-[var(--text-muted)] opacity-20" />
                    </div>
                  </div>
                ) : (
                  <div className="mb-2 rounded overflow-hidden border border-[var(--border-color)] opacity-70 flex" style={{ height: 52 }}>
                    {/* Side rail with section list */}
                    <div className="flex flex-col gap-1 px-1.5 pt-1.5 bg-[var(--bg-secondary)] w-10 shrink-0">
                      <div className="h-1.5 w-6 rounded-sm bg-[var(--accent-color)] opacity-80" />
                      <div className="h-1.5 w-5 rounded-sm bg-[var(--text-muted)] opacity-40" />
                      <div className="h-1.5 w-7 rounded-sm bg-[var(--text-muted)] opacity-40" />
                      <div className="h-1.5 w-4 rounded-sm bg-[var(--text-muted)] opacity-40" />
                    </div>
                    {/* Content area */}
                    <div className="flex-1 px-2 pt-1.5 flex flex-col gap-1 bg-[var(--bg-primary)]">
                      <div className="h-1.5 w-10 rounded-sm bg-[var(--text-muted)] opacity-30" />
                      <div className="h-1.5 w-8 rounded-sm bg-[var(--text-muted)] opacity-20" />
                    </div>
                  </div>
                )}
                <div className="text-xs font-medium">{layout.label}</div>
                <div className="mt-1 text-[11px] opacity-75">{layout.description}</div>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
