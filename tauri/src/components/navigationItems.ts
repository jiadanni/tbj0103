import type { LucideIcon } from "lucide-react";
import {
  BarChart2,
  ClipboardCheck,
  FileEdit,
  History,
  MessageSquare,
} from "lucide-react";

export interface NavigationItem {
  path: string;
  icon: LucideIcon;
  label: string;
}

export const PRIMARY_NAV_ITEMS: NavigationItem[] = [
  { path: "/folder", icon: BarChart2, label: "Dashboard" },
  { path: "/practice", icon: ClipboardCheck, label: "Practice" },
  { path: "/chat", icon: MessageSquare, label: "Chat" },
  { path: "/notes", icon: FileEdit, label: "Library" },
  { path: "/history", icon: History, label: "History" },
];
export type ChatSubView = "chat" | "compare" | "sessions";
export type PreferencesSection = "app" | "navigation" | "appearance" | "chat" | "learning" | "about-you" | "inference" | "inference-jobs" | "webai" | "security" | "workspaces" | "data" | "backup" | "import" | "mcp" | "sync" | "memory" | "logs";
