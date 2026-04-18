import type { LucideIcon } from "lucide-react";
import {
  BarChart2,
  Brain,
  FileEdit,
  FileText,
  Globe,
  History,
  MessageSquare,
  Network,
} from "lucide-react";

export interface NavigationItem {
  path: string;
  icon: LucideIcon;
  label: string;
}

export const PRIMARY_NAV_ITEMS: NavigationItem[] = [
  { path: "/project", icon: BarChart2, label: "Dashboard" },
  { path: "/chat", icon: MessageSquare, label: "Chat" },
  { path: "/notes", icon: FileEdit, label: "Notes" },
  { path: "/documents", icon: FileText, label: "Documents" },
  { path: "/memory", icon: Brain, label: "Memory" },
  { path: "/webcapture", icon: Globe, label: "Web Captures" },
  { path: "/graph", icon: Network, label: "Knowledge" },
  { path: "/history", icon: History, label: "History" },
];
export type ChatSubView = "chat" | "compare" | "sessions";
export type NotesSubView = "notes" | "daily";
export type PreferencesSection = "app" | "navigation" | "appearance" | "chat" | "ai" | "webai" | "security" | "workspaces" | "backup" | "import" | "mcp" | "sync" | "logs";
