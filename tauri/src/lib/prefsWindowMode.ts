import { useState, useCallback } from "react";

const STORAGE_KEY = "prefsWindowSingleInstance";

export function getPrefsWindowSingleInstance(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

/** Returns [isSingleInstance, toggle] — persisted in localStorage. */
export function usePrefsWindowMode(): [boolean, () => void] {
  const [single, setSingle] = useState<boolean>(getPrefsWindowSingleInstance);

  const toggle = useCallback(() => {
    setSingle((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  return [single, toggle];
}
