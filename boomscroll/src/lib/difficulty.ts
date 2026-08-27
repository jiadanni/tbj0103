/**
 * Universal Difficulty Classification & Domain Presets Engine for BoomScroll.
 *
 * Maps a normalized 1–5 difficulty score to industry and educational personas.
 */

export type DifficultyScore = 1 | 2 | 3 | 4 | 5;

export interface DifficultyPreset {
  id: string;
  name: string;
  shortName: string;
  icon: string;
  labels: Record<DifficultyScore, string>;
  descriptions: Record<DifficultyScore, string>;
}

export const DIFFICULTY_PRESETS: Record<string, DifficultyPreset> = {
  software_engineering: {
    id: "software_engineering",
    name: "Software Engineering",
    shortName: "Engineering",
    icon: "💻",
    labels: {
      1: "Novice",
      2: "Junior",
      3: "Intermediate",
      4: "Staff / Lead",
      5: "Principal / Fellow",
    },
    descriptions: {
      1: "Syntax, basic operations, fundamental definitions",
      2: "Standard APIs, common functions, bugfixes, scripting",
      3: "Design patterns, concurrency, state management, refactoring",
      4: "Distributed systems, architectural trade-offs, scalability",
      5: "Internals, compiler/runtime mechanics, zero-downtime at scale",
    },
  },
  academic_k12_higher_ed: {
    id: "academic_k12_higher_ed",
    name: "Academic (K-12 → PhD)",
    shortName: "Academic",
    icon: "🎓",
    labels: {
      1: "Preschool / Elementary",
      2: "Middle School",
      3: "High School / AP",
      4: "Undergraduate (BSc/BA)",
      5: "Graduate / PhD",
    },
    descriptions: {
      1: "Foundational concepts, vocabulary, intuitive metaphors",
      2: "Structured facts, core principles, standard relationships",
      3: "Advanced curriculum, analytical reasoning, multi-step problem solving",
      4: "Specialized domain theory, formal proofs, critical synthesis",
      5: "Cutting-edge research, novel literature, theoretical frontiers",
    },
  },
  medical_clinical: {
    id: "medical_clinical",
    name: "Medicine & Healthcare",
    shortName: "Medicine",
    icon: "🩺",
    labels: {
      1: "Pre-Med / EMT",
      2: "Med Student (MS1-MS2)",
      3: "Clinical Clerk (MS3-MS4)",
      4: "Resident Physician",
      5: "Attending / Specialist",
    },
    descriptions: {
      1: "Basic anatomy, medical terminology, emergency first-aid",
      2: "Pathology, physiology, basic pharmacology",
      3: "Patient diagnostic workups, standard clinical treatments",
      4: "Complex multi-system pathology, surgical & emergency management",
      5: "Subspecialty mastery, rare disease management, clinical innovation",
    },
  },
  aviation_aerospace: {
    id: "aviation_aerospace",
    name: "Aviation & Flight Operations",
    shortName: "Aviation",
    icon: "✈️",
    labels: {
      1: "Student Pilot (VFR)",
      2: "Private Pilot (PPL)",
      3: "Instrument Rated (IFR)",
      4: "Commercial Pilot (CPL)",
      5: "ATP / Captain",
    },
    descriptions: {
      1: "Aerodynamics basics, visual flight rules, cockpit instruments",
      2: "Cross-country navigation, weather reading, airspace classes",
      3: "Instrument navigation, bad weather procedures, precision approaches",
      4: "Multi-engine aircraft, commercial maneuvers, passenger safety",
      5: "Heavy jet systems, crew resource management, emergency decision making",
    },
  },
  legal_jurisprudence: {
    id: "legal_jurisprudence",
    name: "Law & Legal Studies",
    shortName: "Law",
    icon: "⚖️",
    labels: {
      1: "Paralegal / 1L",
      2: "Associate / 2L-3L",
      3: "Practicing Attorney",
      4: "Partner / Senior Counsel",
      5: "Appellate Judge / Scholar",
    },
    descriptions: {
      1: "Basic legal terms, court structure, citation rules",
      2: "Case brief analysis, statutory interpretation, motion drafting",
      3: "Trial strategy, contract negotiation, regulatory compliance",
      4: "Complex litigation, high-stakes corporate deals, cross-border law",
      5: "Constitutional jurisprudence, Supreme Court precedent analysis",
    },
  },
  economics_geopolitics: {
    id: "economics_geopolitics",
    name: "Economics & Geopolitics",
    shortName: "Econ & Geo",
    icon: "🌐",
    labels: {
      1: "Novice",
      2: "Analyst",
      3: "Strategist",
      4: "Policy Advisor",
      5: "Chief Economist / Diplomat",
    },
    descriptions: {
      1: "Foundational definitions, fundamental economic terms, sovereign entities",
      2: "Standard macro/micro mechanics, trade flows, alliance structures",
      3: "Applied macroeconomic modeling, strategic deterrence, sanctions analysis",
      4: "Structural systemic trade-offs, currency dynamics, supply chain sovereignty",
      5: "Hegemonic transitions, systemic crises, multilateral architecture",
    },
  },
  standard_5_star: {
    id: "standard_5_star",
    name: "Standard (Easy → Expert)",
    shortName: "Standard",
    icon: "⭐",
    labels: {
      1: "Easy",
      2: "Medium",
      3: "Difficult",
      4: "Hard",
      5: "Expert",
    },
    descriptions: {
      1: "Introductory basics",
      2: "Accessible everyday knowledge",
      3: "Moderate challenge requiring focus",
      4: "Advanced complexity requiring deep understanding",
      5: "Mastery level for domain specialists",
    },
  },
};

export const DEFAULT_PRESET_ID = "software_engineering";

/** Narrow an arbitrary string to a preset id this build actually knows. */
function validPreset(id: string | undefined): string | undefined {
  return id && DIFFICULTY_PRESETS[id] ? id : undefined;
}

/**
 * Which preset's vocabulary a card should be labelled with.
 *
 * Most specific wins: a preset the deck states for this card's workspace
 * describes the material's own domain, so it beats the user's selection —
 * which acts as a fallback for decks that declare nothing (econ, swe) rather
 * than an override. A deck spanning Music Theory and Roman Empire therefore
 * labels each card from its own workspace instead of one global domain.
 */
export function resolvePresetId(
  card: { difficultyPreset?: string },
  userPresetId?: string,
): string {
  return (
    validPreset(card.difficultyPreset) ??
    validPreset(userPresetId) ??
    DEFAULT_PRESET_ID
  );
}

export function getDifficultyColor(score: DifficultyScore): {
  bg: string;
  border: string;
  text: string;
  dot: string;
} {
  switch (score) {
    case 1:
      return {
        bg: "bg-emerald-950/70",
        border: "border-emerald-700/60",
        text: "text-emerald-300",
        dot: "bg-emerald-400",
      };
    case 2:
      return {
        bg: "bg-sky-950/70",
        border: "border-sky-700/60",
        text: "text-sky-300",
        dot: "bg-sky-400",
      };
    case 3:
      return {
        bg: "bg-amber-950/70",
        border: "border-amber-700/60",
        text: "text-amber-300",
        dot: "bg-amber-400",
      };
    case 4:
      return {
        bg: "bg-orange-950/70",
        border: "border-orange-700/60",
        text: "text-orange-300",
        dot: "bg-orange-400",
      };
    case 5:
      return {
        bg: "bg-rose-950/70",
        border: "border-rose-700/60",
        text: "text-rose-300",
        dot: "bg-rose-400",
      };
  }
}

export function formatDifficultyLabel(
  score: DifficultyScore | undefined,
  presetId?: string,
  customLabel?: string,
): { label: string; score: DifficultyScore } {
  const normalizedScore: DifficultyScore =
    score && score >= 1 && score <= 5 ? (Math.round(score) as DifficultyScore) : 3;

  if (customLabel && customLabel.trim().length > 0) {
    return { label: customLabel.trim(), score: normalizedScore };
  }

  const preset = DIFFICULTY_PRESETS[presetId ?? DEFAULT_PRESET_ID] ?? DIFFICULTY_PRESETS[DEFAULT_PRESET_ID];
  return {
    label: preset.labels[normalizedScore] ?? `Level ${normalizedScore}`,
    score: normalizedScore,
  };
}
