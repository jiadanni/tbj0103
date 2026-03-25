import type { LucideIcon } from "lucide-react";
import {
  BarChart2,
  Calendar,
  CreditCard,
  FileEdit,
  FileText,
  Globe,
  Map,
  MessageSquare,
  MessagesSquare,
  Network,
  PuzzleIcon,
} from "lucide-react";

export interface NavigationItem {
  path: string;
  icon: LucideIcon;
  label: string;
}

export const PRIMARY_NAV_ITEMS: NavigationItem[] = [
  { path: "/project", icon: BarChart2, label: "Dashboard" },
  { path: "/chat", icon: MessageSquare, label: "Chat" },
  { path: "/chat-sessions", icon: MessagesSquare, label: "Chat Sessions" },
  { path: "/notes", icon: FileEdit, label: "Notes" },
  { path: "/daily", icon: Calendar, label: "Daily Notes" },
  { path: "/documents", icon: FileText, label: "Documents" },
  { path: "/webcapture", icon: Globe, label: "Web Captures" },
  { path: "/graph", icon: Network, label: "Knowledge Graph" },
  { path: "/flashcards", icon: CreditCard, label: "Flashcards" },
  { path: "/learning", icon: Map, label: "Learning Paths" },
  { path: "/plugins", icon: PuzzleIcon, label: "Plugins" },
];

export type ChatSubView = "chat" | "grounded" | "compare";
export type GraphSubView = "graph" | "backlinks" | "dedup";
export type PreferencesSection = "general" | "appearance" | "chat" | "ai" | "webai" | "security" | "workspaces" | "backup" | "plugins" | "mcp" | "sync";
