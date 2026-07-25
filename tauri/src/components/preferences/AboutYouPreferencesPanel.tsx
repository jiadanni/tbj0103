import { useEffect, useState } from "react";
import { UserCircle } from "lucide-react";
import { CompactMenuSelect } from "../CompactMenuSelect";
import { Toggle } from "../Toggle";
import { parseAboutYou, serializeAboutYou, EMPTY_ABOUT_YOU, type AboutYouProfile } from "../../lib/aboutYou";

interface AboutYouPreferencesPanelProps {
  initialAboutYou: string | null | undefined;
  injectAboutYouIntoChat: boolean;
  onSaveAboutYou: (val: string) => void;
  onSaveInject: (val: boolean) => void;
}

export function AboutYouPreferencesPanel({
  initialAboutYou,
  injectAboutYouIntoChat,
  onSaveAboutYou,
  onSaveInject,
}: AboutYouPreferencesPanelProps) {
  const [profile, setProfile] = useState<AboutYouProfile>(() => {
    return parseAboutYou(initialAboutYou) ?? { ...EMPTY_ABOUT_YOU };
  });

  // Re-sync local profile state when the parent's stored value changes from
  // an external source (cross-window save, blob refetch). Safe to call
  // setState here because initialAboutYou only changes between renders, not
  // every render — so this does not cascade.
  useEffect(() => {
    const parsed = parseAboutYou(initialAboutYou) ?? { ...EMPTY_ABOUT_YOU };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfile(parsed);
  }, [initialAboutYou]);

  const updateField = (key: keyof AboutYouProfile, value: string) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
  };

  const commitField = (key: keyof AboutYouProfile, value: string) => {
    const updatedProfile = { ...profile, [key]: value };
    onSaveAboutYou(serializeAboutYou(updatedProfile));
  };

  const inputCls = "w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-color)]";

  return (
    <div className="space-y-8">
      <section className="space-y-3" data-pref-section>
        <div className="pb-1.5 border-b border-[var(--border-color)]">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] flex items-center gap-1.5">
            <UserCircle size={11} /> About You
          </h3>
          <p className="text-xs text-[var(--text-muted)]/80 mt-1">
            Tell Aetherium about yourself. This context is shared with the AI when generating learning goals, workspace prompts, and chat responses (toggle below) so it can tailor answers to your background.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Display name</span>
            <input
              type="text"
              value={profile.display_name}
              onChange={(e) => updateField("display_name", e.target.value)}
              onBlur={(e) => commitField("display_name", e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
              placeholder="e.g. Alex"
              className={inputCls}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Profession / role</span>
            <input
              type="text"
              value={profile.profession}
              onChange={(e) => updateField("profession", e.target.value)}
              onBlur={(e) => commitField("profession", e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
              placeholder="e.g. Backend engineer"
              className={inputCls}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Education level</span>
            <CompactMenuSelect
              label="Education level"
              value={profile.education_level}
              onChange={(v) => {
                updateField("education_level", v);
                const updatedProfile = { ...profile, education_level: v };
                onSaveAboutYou(serializeAboutYou(updatedProfile));
              }}
              options={[
                { value: "", label: "—" },
                { value: "high-school", label: "High school" },
                { value: "undergraduate", label: "Undergraduate" },
                { value: "graduate", label: "Graduate" },
                { value: "postgraduate", label: "Postgraduate" },
                { value: "self-taught", label: "Self-taught" },
                { value: "other", label: "Other" },
              ]}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Field of study / expertise</span>
            <input
              type="text"
              value={profile.field_of_study}
              onChange={(e) => updateField("field_of_study", e.target.value)}
              onBlur={(e) => commitField("field_of_study", e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
              placeholder="e.g. Distributed systems"
              className={inputCls}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Preferred language</span>
            <input
              type="text"
              value={profile.preferred_language}
              onChange={(e) => updateField("preferred_language", e.target.value)}
              onBlur={(e) => commitField("preferred_language", e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
              placeholder="e.g. English"
              className={inputCls}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Default learning approach</span>
            <CompactMenuSelect
              label="Default learning approach"
              value={profile.default_approach}
              onChange={(v) => {
                updateField("default_approach", v);
                const updatedProfile = { ...profile, default_approach: v };
                onSaveAboutYou(serializeAboutYou(updatedProfile));
              }}
              options={[
                { value: "", label: "—" },
                { value: "theory-first", label: "Theory first" },
                { value: "hands-on", label: "Hands-on / examples" },
                { value: "balanced", label: "Balanced" },
              ]}
            />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-[var(--text-secondary)]">Interests</span>
          <textarea
            value={profile.interests}
            onChange={(e) => updateField("interests", e.target.value)}
            onBlur={(e) => commitField("interests", e.target.value)}
            placeholder="Topics you like to learn about"
            rows={2}
            className={inputCls}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-[var(--text-secondary)]">Bio</span>
          <textarea
            value={profile.bio}
            onChange={(e) => updateField("bio", e.target.value)}
            onBlur={(e) => commitField("bio", e.target.value)}
            placeholder="Anything else the AI should know about you"
            rows={4}
            className={inputCls}
          />
        </label>
      </section>

      <section className="space-y-3" data-pref-section>
        <div className="pb-1.5 border-b border-[var(--border-color)]">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Chat prompt</h3>
        </div>
        <div className="flex items-center justify-between gap-3 py-0.5">
          <div>
            <p className="text-sm text-[var(--text-secondary)]">Inject About You into chat system prompt</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              When on, your profile is prepended to the chat system prompt so the assistant can adapt its answers. Goal and workspace prompt generation always use it.
            </p>
          </div>
          <Toggle
            on={injectAboutYouIntoChat}
            onToggle={() => onSaveInject(!injectAboutYouIntoChat)}
          />
        </div>
      </section>
    </div>
  );
}
