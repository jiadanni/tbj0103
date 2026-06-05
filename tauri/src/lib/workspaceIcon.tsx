import { createElement } from "react";
import * as Lucide from "lucide-react";
import { Folder, type LucideIcon } from "lucide-react";

function pascal(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

function resolveIcon(name?: string | null): LucideIcon {
  if (!name) {
    return Folder;
  }
  const key = pascal(name);
  const Cmp = (Lucide as unknown as Record<string, LucideIcon>)[key];
  return Cmp ?? Folder;
}

export function WorkspaceIcon({
  name,
  className,
}: {
  name?: string | null;
  className?: string;
}) {
  return createElement(resolveIcon(name), { className, "aria-hidden": true });
}
