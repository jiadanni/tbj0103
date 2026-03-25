import type { LucideIcon } from "lucide-react";
import {
  BarChart2,
  FileEdit,
  FileText,
  Globe,
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
  { path: "/webcapture", icon: Globe, label: "Web Captures" },
  { path: "/graph", icon: Network, label: "Knowledge Graph" },
];

export type ChatSubView = "chat" | "grounded" | "compare" | "sessions";
export type NotesSubView = "notes" | "daily";
export type GraphSubView = "graph" | "backlinks" | "dedup" | "flashcards" | "learning";
export type PreferencesSection = "general" | "appearance" | "chat" | "ai" | "webai" | "security" | "workspaces" | "backup" | "plugins" | "mcp" | "sync";
