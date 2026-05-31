// Mirror of src-tauri/src/services/about_you.rs. Keep field names and the
// rendered prompt block in sync so client-side survey flows produce the
// same text as the Rust resolver.

export interface AboutYouProfile {
  display_name: string;
  profession: string;
  education_level: string;
  field_of_study: string;
  interests: string;
  preferred_language: string;
  default_approach: string;
  bio: string;
}

export const EMPTY_ABOUT_YOU: AboutYouProfile = {
  display_name: "",
  profession: "",
  education_level: "",
  field_of_study: "",
  interests: "",
  preferred_language: "",
  default_approach: "",
  bio: "",
};

export function parseAboutYou(raw: string | null | undefined): AboutYouProfile | null {
  if (!raw) {return null;}
  const trimmed = raw.trim();
  if (!trimmed) {return null;}
  try {
    let parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "string") {
      const inner = parsed.trim();
      if (!inner) {return null;}
      parsed = JSON.parse(inner);
    }
    if (!parsed || typeof parsed !== "object") {return null;}
    const obj = parsed as Record<string, unknown>;
    const pick = (k: string): string => (typeof obj[k] === "string" ? (obj[k] as string) : "");
    return {
      display_name: pick("display_name"),
      profession: pick("profession"),
      education_level: pick("education_level"),
      field_of_study: pick("field_of_study"),
      interests: pick("interests"),
      preferred_language: pick("preferred_language"),
      default_approach: pick("default_approach"),
      bio: pick("bio"),
    };
  } catch {
    return null;
  }
}

export function serializeAboutYou(profile: AboutYouProfile): string {
  return JSON.stringify(profile);
}

export function isProfileEmpty(profile: AboutYouProfile | null | undefined): boolean {
  if (!profile) {return true;}
  return (
    !profile.display_name.trim() &&
    !profile.profession.trim() &&
    !profile.education_level.trim() &&
    !profile.field_of_study.trim() &&
    !profile.interests.trim() &&
    !profile.preferred_language.trim() &&
    !profile.default_approach.trim() &&
    !profile.bio.trim()
  );
}

export function formatAboutYouForPrompt(profile: AboutYouProfile | null | undefined): string {
  if (!profile) {return "";}
  const lines: string[] = [];
  const push = (label: string, val: string) => {
    const v = val.trim();
    if (v) {lines.push(`- ${label}: ${v}`);}
  };
  push("Name", profile.display_name);
  push("Profession / role", profile.profession);
  push("Education level", profile.education_level);
  push("Field of study / expertise", profile.field_of_study);
  push("Interests", profile.interests);
  push("Preferred language", profile.preferred_language);
  push("Preferred learning approach", profile.default_approach);
  push("Bio", profile.bio);
  if (lines.length === 0) {return "";}
  return `About the user:\n${lines.join("\n")}`;
}

/**
 * Resolve the effective profile: workspace override (if non-empty) → global.
 * Pass the raw stored strings; returns the resolved profile or null.
 */
export function resolveAboutYou(
  workspaceOverrideRaw: string | null | undefined,
  globalRaw: string | null | undefined,
): AboutYouProfile | null {
  const ws = parseAboutYou(workspaceOverrideRaw);
  if (ws && !isProfileEmpty(ws)) {return ws;}
  const global = parseAboutYou(globalRaw);
  if (global && !isProfileEmpty(global)) {return global;}
  return null;
}
