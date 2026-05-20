import React, { useState, useRef, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { lookupTechTerm } from "../lib/techDictionary";
import { useChatStore } from "../stores/chatStore";

export interface WordDefinition {
  word: string;
  phonetic?: string;
  partOfSpeech?: string;
  definition: string;
  source: "workspace" | "tech" | "dictionary";
  sourceDetail?: string;
  x: number;
  y: number;
}

interface DictApiMeaning {
  partOfSpeech: string;
  definitions: { definition: string }[];
}

interface DictApiEntry {
  word: string;
  phonetic?: string;
  meanings: DictApiMeaning[];
}

const CACHE = new Map<string, Omit<WordDefinition, "x" | "y"> | "not_found">();
const TOKEN_CHAR_RE = /[A-Za-z0-9.+#/_-]/;

function hasActiveSelection() {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

function buildGlossaryCandidates(text: string, offset: number): string[] {
  if (!text.trim()) {
    return [];
  }

  let left = offset;
  while (left > 0) {
    const char = text[left - 1];
    if (!TOKEN_CHAR_RE.test(char) && char !== " ") {
      break;
    }
    left -= 1;
  }

  let right = offset;
  while (right < text.length) {
    const char = text[right];
    if (!TOKEN_CHAR_RE.test(char) && char !== " ") {
      break;
    }
    right += 1;
  }

  const segment = text.slice(left, right).replace(/\s+/g, " ").trim();
  if (!segment) {
    return [];
  }

  const parts = segment.split(" ").filter(Boolean);
  if (parts.length === 0) {
    return [];
  }

  const relativeOffset = offset - left;
  let runningIndex = 0;
  let hoveredWordIndex = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const start = runningIndex;
    const end = runningIndex + parts[index].length;
    if (relativeOffset >= start && relativeOffset <= end) {
      hoveredWordIndex = index;
      break;
    }
    runningIndex = end + 1;
  }

  const seen = new Set<string>();
  const candidates: string[] = [];
  for (let length = Math.min(4, parts.length); length >= 1; length -= 1) {
    for (let start = 0; start <= parts.length - length; start += 1) {
      const end = start + length - 1;
      if (hoveredWordIndex < start || hoveredWordIndex > end) {
        continue;
      }
      const phrase = parts.slice(start, start + length).join(" ").toLowerCase();
      if (!seen.has(phrase)) {
        seen.add(phrase);
        candidates.push(phrase);
      }
    }
  }

  return candidates;
}

/**
 * Hook that detects when the mouse hovers over a word for a certain period
 * and returns a definition from a tech dictionary or a public API.
 */
export function useWordHover(
  containerRef: React.RefObject<HTMLElement | null>,
  workspaceId?: string | null,
) {
  const [definition, setDefinition] = useState<WordDefinition | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStreaming = useChatStore((s) => s.streamingSessionId !== null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    clearTimer();
    setDefinition(null);

    // Skip if streaming or container not available
    if (isStreaming || !containerRef.current || hasActiveSelection()) {return;}

    const x = e.clientX;
    const y = e.clientY;

    timerRef.current = setTimeout(async () => {
      if (hasActiveSelection()) {return;}

      // Get the character at the mouse position
      // Using standard caretRangeFromPoint (Chrome/Webkit)
      const range = document.caretRangeFromPoint(x, y);
      if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) {return;}

      const textNode = range.startContainer as Text;
      const offset = range.startOffset;
      const text = textNode.textContent || "";

      // Guard: Ensure we are not inside a code or pre block
      let parent = textNode.parentElement;
      while (parent && parent !== containerRef.current) {
        if (parent.tagName === "CODE" || parent.tagName === "PRE") {return;}
        parent = parent.parentElement;
      }

      const candidates = buildGlossaryCandidates(text, offset).filter((candidate) => candidate.length >= 2);
      if (candidates.length === 0) {return;}

      if (workspaceId) {
        const glossaryCacheKey = `${workspaceId}::${candidates[0]}`;
        const cachedGlossary = CACHE.get(glossaryCacheKey);
        if (cachedGlossary === "not_found") {return;}
        if (cachedGlossary) {
          setDefinition({ ...cachedGlossary, x, y });
          return;
        }

        try {
          const glossaryMatch = await api.workspaceGlossary.resolve(workspaceId, candidates);
          if (glossaryMatch) {
            const result: Omit<WordDefinition, "x" | "y"> = {
              word: glossaryMatch.term,
              definition: glossaryMatch.definition,
              source: "workspace",
              sourceDetail: glossaryMatch.source_kind,
            };
            CACHE.set(glossaryCacheKey, result);
            setDefinition({ ...result, x, y });
            return;
          }
          CACHE.set(glossaryCacheKey, "not_found");
        } catch (err) {
          console.error("Workspace glossary lookup error:", err);
        }
      }

      const word = candidates[candidates.length - 1];
      const tech = lookupTechTerm(word);
      if (tech) {
        setDefinition({
          word: tech.word,
          definition: tech.definition,
          source: "tech",
          x,
          y,
        });
        return;
      }

      // 3. Check local session cache
      const cached = CACHE.get(word);
      if (cached === "not_found") {return;}
      if (cached) {
        setDefinition({ ...cached, x, y });
        return;
      }

      // Public dictionary fallback is single-word only.
      if (word.includes(" ")) {
        CACHE.set(word, "not_found");
        return;
      }

      // 4. Fetch from public dictionary API
      try {
        const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
        if (!res.ok) {
          CACHE.set(word, "not_found");
          return;
        }
        
        const data = (await res.json()) as DictApiEntry[];
        const entry = data[0];
        if (!entry) {
          CACHE.set(word, "not_found");
          return;
        }

        const firstMeaning = entry.meanings[0];
        const result: Omit<WordDefinition, "x" | "y"> = {
          word: entry.word,
          phonetic: entry.phonetic,
          partOfSpeech: firstMeaning?.partOfSpeech,
          definition: firstMeaning?.definitions[0]?.definition || "No definition found.",
          source: "dictionary",
        };

        CACHE.set(word, result);
        setDefinition({ ...result, x, y });
      } catch (err) {
        console.error("Dictionary API fetch error:", err);
        CACHE.set(word, "not_found");
      }
    }, 800); // 800ms hover duration
  }, [containerRef, isStreaming, clearTimer, workspaceId]);

  const handleMouseLeave = useCallback(() => {
    clearTimer();
    setDefinition(null);
  }, [clearTimer]);

  const handleSelectionChange = useCallback(() => {
    if (!hasActiveSelection()) {return;}
    clearTimer();
    setDefinition(null);
  }, [clearTimer]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {return;}

    el.addEventListener("mousemove", handleMouseMove);
    el.addEventListener("mouseleave", handleMouseLeave);
    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      el.removeEventListener("mousemove", handleMouseMove);
      el.removeEventListener("mouseleave", handleMouseLeave);
      document.removeEventListener("selectionchange", handleSelectionChange);
      clearTimer();
    };
  }, [containerRef, handleMouseMove, handleMouseLeave, handleSelectionChange, clearTimer]);

  return definition;
}
