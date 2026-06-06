const GENERIC_ICON_NAMES = new Set(["", "folder", "brain"]);

const WORKSPACE_ICON_RULES: { keywords: string[]; icon: string }[] = [
  { keywords: ["python", "rust", "javascript", "typescript", "java", "code", "programming", "frontend", "react", "c++", " c ", "binary", "dsa"], icon: "code" },
  { keywords: ["ux", "ui", "design"], icon: "palette" },
  { keywords: ["health", "strength", "fitness", "workout", "medical", "wellness"], icon: "heart-pulse" },
  { keywords: ["deen", "faith", "islam", "religion", "spiritual"], icon: "book-open" },
  { keywords: ["gemini", "ai", "agentic", "ml", "machine learning"], icon: "sparkles" },
  { keywords: ["music", "musical", "song"], icon: "music" },
  { keywords: ["integrate", "integration", "api", "apis"], icon: "plug" },
  { keywords: ["man", "people", "person"], icon: "user" },
  { keywords: ["bash", "linux", "shell", "terminal", "cli"], icon: "terminal" },
  { keywords: ["git", "github"], icon: "git-branch" },
  { keywords: ["database", "databases", "sql"], icon: "database" },
  { keywords: ["security", "privacy", "crypto"], icon: "shield-check" },
  { keywords: ["container", "containerization", "docker", "kubernetes"], icon: "container" },
  { keywords: ["10x", "productivity"], icon: "rocket" },
];

export function inferWorkspaceIconName(label?: string | null): string {
  const input = ` ${label ?? ""} `.toLowerCase();
  const rule = WORKSPACE_ICON_RULES.find(({ keywords }) => keywords.some((keyword) => input.includes(keyword)));
  return rule?.icon ?? "folder";
}

export function resolveWorkspaceIconName(icon?: string | null, label?: string | null): string {
  const normalizedIcon = (icon ?? "").trim().toLowerCase();
  if (!GENERIC_ICON_NAMES.has(normalizedIcon)) {
    return normalizedIcon;
  }
  return inferWorkspaceIconName(label);
}
