import { Brain, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Toggle } from "../Toggle";
import { useSettingsStore } from "../../stores/settingsStore";
import type { PreferencesSection } from "../navigationItems";

interface LearningPreferencesPanelProps {
  onNavigateToTab: (tab: PreferencesSection) => void;
}

export function LearningPreferencesPanel({ onNavigateToTab }: LearningPreferencesPanelProps) {
  const autoGenerateFlashcards = useSettingsStore((state) => state.autoGenerateFlashcards);
  const setAutoGenerateFlashcards = useSettingsStore((state) => state.setAutoGenerateFlashcards);
  const flashcardModel = useSettingsStore((state) => state.flashcardModel);
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-8">
      <section className="space-y-3" data-pref-section>
        <div className="pb-1.5 border-b border-[var(--border-color)] flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] flex items-center gap-1.5">
              <Sparkles size={11} /> Flashcards
            </h3>
            <p className="text-xs text-[var(--text-muted)]/80 mt-1">
              Aetherium can extract flashcards from your chats so you can review them later.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer whitespace-nowrap">
            <Toggle
              on={autoGenerateFlashcards}
              onToggle={() => setAutoGenerateFlashcards(!autoGenerateFlashcards)}
            />
            <span className="text-[var(--text-secondary)]">Auto-generate from chats</span>
          </label>
        </div>
        <div className="flex items-center justify-between gap-3 pt-1">
          <div>
            <p className="text-sm text-[var(--text-secondary)]">Generation model</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {flashcardModel
                ? `Using ${flashcardModel}`
                : "Uses the background-job default model."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigateToTab("inference")}
            className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors whitespace-nowrap"
          >
            Configure in AI →
          </button>
        </div>
      </section>

      <section className="space-y-3" data-pref-section>
        <div className="pb-1.5 border-b border-[var(--border-color)]">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] flex items-center gap-1.5">
            <Brain size={11} /> Knowledge
          </h3>
          <p className="text-xs text-[var(--text-muted)]/80 mt-1">
            A roadmap of concepts Aetherium has extracted from your workspace. Use it to navigate what you&apos;ve learned and spot gaps.
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-[var(--text-muted)]">
            The roadmap rebuilds itself as you chat, take notes, and capture sources in the active workspace.
          </p>
          <button
            type="button"
            onClick={() => navigate("/graph")}
            className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors whitespace-nowrap"
          >
            Open Knowledge Graph →
          </button>
        </div>
      </section>
    </div>
  );
}
