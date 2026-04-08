import React, { useState, useRef, useEffect, useCallback } from "react";
import { lookupTechTerm } from "../lib/techDictionary";
import { useChatStore } from "../stores/chatStore";

export interface WordDefinition {
  word: string;
  phonetic?: string;
  partOfSpeech?: string;
  definition: string;
  isTechTerm: boolean;
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

function hasActiveSelection() {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

/**
 * Hook that detects when the mouse hovers over a word for a certain period
 * and returns a definition from a tech dictionary or a public API.
 */
export function useWordHover(containerRef: React.RefObject<HTMLDivElement | null>) {
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

      // Extract the word at the cursor position
      const leftPart = text.slice(0, offset).match(/[\w-]+$/);
      const rightPart = text.slice(offset).match(/^[\w-]+/);
      
      const word = ((leftPart ? leftPart[0] : "") + (rightPart ? rightPart[0] : "")).toLowerCase();

      // Minimum 2 characters for lookup
      if (!word || word.length < 2) {return;}

      // 1. Check built-in Tech Dictionary first
      const tech = lookupTechTerm(word);
      if (tech) {
        setDefinition({
          word: tech.word,
          definition: tech.definition,
          isTechTerm: true,
          x,
          y,
        });
        return;
      }

      // 2. Check local session cache
      const cached = CACHE.get(word);
      if (cached === "not_found") {return;}
      if (cached) {
        setDefinition({ ...cached, x, y });
        return;
      }

      // 3. Fetch from public dictionary API
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
          isTechTerm: false,
        };

        CACHE.set(word, result);
        setDefinition({ ...result, x, y });
      } catch (err) {
        console.error("Dictionary API fetch error:", err);
        CACHE.set(word, "not_found");
      }
    }, 800); // 800ms hover duration
  }, [containerRef, isStreaming, clearTimer]);

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
