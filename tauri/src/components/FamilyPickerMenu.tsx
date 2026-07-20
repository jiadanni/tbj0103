import { useState } from "react";
import { ChevronRight, Check } from "lucide-react";
import type { AiModel } from "../lib/api";

export interface FamilyPickerMenuProps {
  modelFamilies: Array<{ prefix: string; label: string; models: AiModel[] }>;
  selectedFamily: string | null;
  selectedModel: string | null;
  onSelect: (familyPrefix: string, modelId: string) => void;
}

export function FamilyPickerMenu({ modelFamilies, selectedFamily, selectedModel, onSelect }: FamilyPickerMenuProps) {
  const [hoveredFamilyPrefix, setHoveredFamilyPrefix] = useState<string | null>(selectedFamily);
  const hoveredFamily = modelFamilies.find((f) => f.prefix === hoveredFamilyPrefix) ?? null;
  return (
    <div className="absolute right-0 bottom-full z-20 mb-2 flex shadow-2xl">
      <div className="w-[180px] overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-sidebar)] p-1.5">
        {modelFamilies.map((family) => {
          const isSel = family.prefix === selectedFamily;
          const isHov = family.prefix === hoveredFamilyPrefix;
          return (
            <button
              type="button"
              key={family.prefix}
              onMouseEnter={() => setHoveredFamilyPrefix(family.prefix)}
              onClick={() => setHoveredFamilyPrefix(family.prefix)}
              className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                isHov || isSel
                  ? "bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              <div className="min-w-0 truncate">{family.label}</div>
              <ChevronRight size={13} className="shrink-0 text-[var(--text-muted)]" />
            </button>
          );
        })}
      </div>
      {hoveredFamily && hoveredFamily.models.length > 0 && (
        <div className="ml-1.5 w-[180px] overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-sidebar)] p-1.5">
          {hoveredFamily.models.map((m) => {
            const tag = m.model_id.includes(":") ? m.model_id.split(":")[1] : m.model_id;
            const isModelSel = m.model_id === selectedModel;
            return (
              <button
                type="button"
                key={m.model_id}
                onClick={() => onSelect(hoveredFamily.prefix, m.model_id)}
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                  isModelSel
                    ? "bg-[rgba(var(--accent-color-rgb),0.12)] text-[var(--accent-color)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                }`}
              >
                <div className="min-w-0 truncate">{tag}</div>
                {isModelSel && <Check size={13} className="shrink-0 text-[var(--accent-color)]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
