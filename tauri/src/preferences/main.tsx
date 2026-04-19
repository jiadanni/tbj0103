import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { useSettingsStore } from "../stores/settingsStore";
import { normalizeTheme } from "../lib/theme";
import { installConsoleTimestamps } from "../lib/consoleTimestamps";
import { isLinux } from "../lib/platform";
import PreferencesView from "../views/PreferencesView";
import "../styles/globals.css";

export function PreferencesApp() {
  const theme = useSettingsStore((state) => state.theme);
  const accentColor = useSettingsStore((state) => state.accentColor);
  const fontSize = useSettingsStore((state) => state.fontSize);

  // Mirror theme / accent / font-size onto <html> (same as main App)
  useEffect(() => {
    const root = document.documentElement;
    const normalizedTheme = normalizeTheme(theme);
    root.classList.forEach((cls) => {
      if (cls.startsWith("theme-")) { root.classList.remove(cls); }
    });
    root.classList.add(`theme-${normalizedTheme}`);
    if (accentColor) { root.style.setProperty("--accent-color", accentColor); }
    root.style.setProperty("--font-size-base", `${fontSize}px`);
    root.style.fontSize = `${fontSize}px`;
  }, [theme, accentColor, fontSize]);

  return (
    <MemoryRouter>
      <div className="flex h-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <PreferencesView />
      </div>
    </MemoryRouter>
  );
}

installConsoleTimestamps();

if (isLinux) {
  document.documentElement.dataset.platform = "linux";
}

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PreferencesApp />
  </React.StrictMode>
);
