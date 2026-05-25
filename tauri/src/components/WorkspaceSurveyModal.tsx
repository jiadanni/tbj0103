/**
 * WorkspaceSurveyModal — 3-step workspace survey used to seed the roadmap generator.
 * Answers are saved as JSON on the workspace and injected as AI context.
 */
import { useState } from "react";
import { ChevronRight, ChevronLeft, X } from "lucide-react";

type SkillLevel =
  | "beginner"
  | "high_school"
  | "intermediate"
  | "grad"
  | "postgrad"
  | "advanced";

type LearningApproach = "theory" | "hands-on" | "balanced";

export interface WorkspaceSurvey {
  topic: string;
  skillLevel: SkillLevel;
  goal: string;
  hoursPerWeek: string;
  focusAreas: string;
  approach: LearningApproach;
}

export function formatSurveyForPrompt(survey: WorkspaceSurvey): string {
  const skillLabels: Record<SkillLevel, string> = {
    beginner: "Beginner",
    high_school: "High-school level",
    intermediate: "Intermediate",
    grad: "Graduate level",
    postgrad: "Post-graduate level",
    advanced: "Advanced / expert",
  };
  const approachLabels: Record<LearningApproach, string> = {
    theory: "Theory-first",
    "hands-on": "Hands-on / project-based",
    balanced: "Balanced mix",
  };
  const lines: string[] = ["Learner context for this workspace:"];
  if (survey.topic.trim()) {lines.push(`- Subject / topic: ${survey.topic.trim()}`);}
  lines.push(`- Skill level: ${skillLabels[survey.skillLevel]}`);
  if (survey.goal.trim()) {lines.push(`- Primary goal: ${survey.goal.trim()}`);}
  if (survey.hoursPerWeek) {lines.push(`- Available time: ${survey.hoursPerWeek} hours/week`);}
  if (survey.focusAreas.trim()) {lines.push(`- Focus / avoid areas: ${survey.focusAreas.trim()}`);}
  lines.push(`- Preferred approach: ${approachLabels[survey.approach]}`);
  return lines.join("\n");
}

const EMPTY_SURVEY: WorkspaceSurvey = {
  topic: "",
  skillLevel: "intermediate",
  goal: "",
  hoursPerWeek: "3-7",
  focusAreas: "",
  approach: "balanced",
};

interface Props {
  initialData: WorkspaceSurvey | null;
  onSubmit: (survey: WorkspaceSurvey) => void;
  onClose: () => void;
}

const SKILL_OPTIONS: { value: SkillLevel; label: string; hint?: string }[] = [
  { value: "beginner", label: "Beginner", hint: "Starting from scratch" },
  { value: "high_school", label: "High School", hint: "Covered basics in school" },
  { value: "intermediate", label: "Intermediate", hint: "Comfortable with fundamentals" },
  { value: "grad", label: "Graduate", hint: "University / grad-level study" },
  { value: "postgrad", label: "Post-Graduate", hint: "Masters / PhD level" },
  { value: "advanced", label: "Advanced", hint: "Expert practitioner" },
];

const HOURS_OPTIONS = [
  { value: "<1", label: "< 1 hr" },
  { value: "1-3", label: "1–3 hrs" },
  { value: "3-7", label: "3–7 hrs" },
  { value: "7+", label: "7+ hrs" },
];

const APPROACH_OPTIONS: { value: LearningApproach; label: string; hint: string }[] = [
  { value: "theory", label: "Theory-first", hint: "Concepts and principles before practice" },
  { value: "hands-on", label: "Hands-on", hint: "Projects and exercises first" },
  { value: "balanced", label: "Balanced", hint: "Mix of both" },
];

const PRESET_GOALS = [
  "Prepare for a job interview",
  "Complete a personal project",
  "Academic study / coursework",
  "General curiosity / hobby",
  "Professional skill development",
];

export default function WorkspaceSurveyModal({ initialData, onSubmit, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<WorkspaceSurvey>(initialData ?? EMPTY_SURVEY);

  function set<K extends keyof WorkspaceSurvey>(key: K, value: WorkspaceSurvey[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit() {
    onSubmit(form);
  }

  const totalSteps = 3;
  const canNext =
    step === 0
      ? form.topic.trim().length > 0
      : step === 1
        ? form.goal.trim().length > 0
        : true;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[480px] max-h-[90vh] overflow-y-auto bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded-2xl shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {initialData ? "Edit Roadmap Setup" : "Setup Your Learning Roadmap"}
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Step {step + 1} of {totalSteps}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
          >
            <X size={14} />
          </button>
        </div>

        {/* Progress dots */}
        <div className="flex gap-1.5 px-6 pb-4">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= step ? "bg-[var(--accent-color)]" : "bg-[var(--bg-hover)]"
              }`}
            />
          ))}
        </div>

        <div className="px-6 pb-6 flex flex-col gap-5 flex-1">
          {/* ---- Step 0: Topic + Skill Level ---- */}
          {step === 0 && (
            <>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-[var(--text-secondary)]">
                  What is the main subject or topic of this workspace? *
                </label>
                <input
                  autoFocus
                  value={form.topic}
                  onChange={(e) => set("topic", e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && canNext) { setStep(1); } }}
                  placeholder="e.g. Android development, Quantum mechanics, French…"
                  className="px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-[var(--text-secondary)]">
                  What is your current skill level?
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {SKILL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => set("skillLevel", opt.value)}
                      className={`flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-colors ${
                        form.skillLevel === opt.value
                          ? "border-[var(--accent-color)] bg-[var(--accent-color)]/10"
                          : "border-[var(--border-color)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      <span className="text-xs font-medium text-[var(--text-primary)]">{opt.label}</span>
                      {opt.hint && (
                        <span className="text-[10px] text-[var(--text-muted)]">{opt.hint}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ---- Step 1: Goal + Hours/Week ---- */}
          {step === 1 && (
            <>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-[var(--text-secondary)]">
                  What is your primary learning goal? *
                </label>
                <div className="flex flex-wrap gap-1.5 mb-1">
                  {PRESET_GOALS.map((g) => (
                    <button
                      key={g}
                      onClick={() => set("goal", g)}
                      className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                        form.goal === g
                          ? "border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--accent-color)]"
                          : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                <input
                  value={form.goal}
                  onChange={(e) => set("goal", e.target.value)}
                  placeholder="Or describe your own goal…"
                  className="px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-color)]"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-[var(--text-secondary)]">
                  How much time per week can you dedicate to learning?
                </label>
                <div className="flex gap-2">
                  {HOURS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => set("hoursPerWeek", opt.value)}
                      className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-colors ${
                        form.hoursPerWeek === opt.value
                          ? "border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--accent-color)]"
                          : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ---- Step 2: Focus areas + Approach ---- */}
          {step === 2 && (
            <>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-[var(--text-secondary)]">
                  Any specific sub-topics to focus on or avoid?{" "}
                  <span className="font-normal text-[var(--text-muted)]">(optional)</span>
                </label>
                <textarea
                  autoFocus
                  value={form.focusAreas}
                  onChange={(e) => set("focusAreas", e.target.value)}
                  placeholder="e.g. Focus on Jetpack Compose and MVVM. Skip XML layouts."
                  rows={3}
                  className="px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none resize-none focus:border-[var(--accent-color)]"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-[var(--text-secondary)]">
                  Preferred learning approach?
                </label>
                <div className="flex flex-col gap-2">
                  {APPROACH_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => set("approach", opt.value)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                        form.approach === opt.value
                          ? "border-[var(--accent-color)] bg-[var(--accent-color)]/10"
                          : "border-[var(--border-color)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      <div
                        className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 transition-colors ${
                          form.approach === opt.value
                            ? "border-[var(--accent-color)] bg-[var(--accent-color)]"
                            : "border-[var(--border-color)]"
                        }`}
                      />
                      <div>
                        <p className="text-xs font-medium text-[var(--text-primary)]">{opt.label}</p>
                        <p className="text-[10px] text-[var(--text-muted)]">{opt.hint}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer navigation */}
        <div className="flex gap-2 px-6 pb-5">
          {step > 0 ? (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="flex items-center gap-1 px-3 py-2 rounded-lg border border-[var(--border-color)] text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              <ChevronLeft size={12} /> Back
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-3 py-2 rounded-lg border border-[var(--border-color)] text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              Cancel
            </button>
          )}
          <div className="flex-1" />
          {step < totalSteps - 1 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canNext}
              className="flex items-center gap-1 px-4 py-2 rounded-lg bg-[var(--accent-color)] text-white text-xs hover:opacity-90 disabled:opacity-40"
            >
              Next <ChevronRight size={12} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              className="px-4 py-2 rounded-lg bg-[var(--accent-color)] text-white text-xs hover:opacity-90"
            >
              Generate Roadmap
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
