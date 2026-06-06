import React from "react";

export type McMenubarMockIconStyle = "monochrome" | "white" | "black";

interface McMenubarMockProps {
  /** Whether the OS-style application menu items ("File / Edit / View /
   *  Workspace") render. When the user enables "Hide native menu" the real
   *  macOS menubar would be empty, so the mock hides them too. */
  showAppMenu?: boolean;
  /** Background inference toggle from preferences; mirrored into the
   *  "Jobs: Active / Disabled" status text on the right. */
  backgroundInferenceEnabled?: boolean;
  /** Which menubar icon style preference to render in the corner. */
  iconStyle?: McMenubarMockIconStyle;
}

/**
 * Stylized macOS-style menubar shown above the Live App Preview window.
 * The real macOS menubar is a system surface, so there's no in-app
 * counterpart — this component exists purely so the menubar markup lives
 * outside the giant inline LiveAppPreview JSX in PreferencesView.tsx and
 * can be updated in one place when menubar-affecting preferences change.
 */
export function McMenubarMock({
  showAppMenu = true,
  backgroundInferenceEnabled = false,
  iconStyle = "monochrome",
}: McMenubarMockProps) {
  return (
    <div className="w-full h-6 bg-[var(--bg-sidebar)]/80 text-[var(--text-muted)] text-[0.7em] px-3 rounded-t-xl flex justify-between items-center select-none border-t border-x border-[var(--border-color)]">
      <div className="flex gap-2.5 items-center">
        <span className="font-semibold text-[var(--text-primary)]"></span>
        <span className="font-medium text-[var(--text-secondary)]">Aetherium</span>
        {showAppMenu && (
          <div className="flex gap-2.5 opacity-60">
            <span>File</span>
            <span>Edit</span>
            <span>View</span>
            <span>Workspace</span>
          </div>
        )}
      </div>
      <div className="flex gap-2.5 items-center">
        <span>Jobs: {backgroundInferenceEnabled ? "Active" : "Disabled"}</span>
        <span>100%</span>
        <div className="flex items-center">
          {iconStyle === "white" ? (
            <span className="w-3.5 h-3.5 rounded bg-white flex items-center justify-center text-black font-extrabold text-[8px]">A</span>
          ) : iconStyle === "black" ? (
            <span className="w-3.5 h-3.5 rounded bg-black text-white flex items-center justify-center font-extrabold text-[8px] border border-white/20">A</span>
          ) : (
            /* monochrome (adapts to text color) */
            <span className="w-3.5 h-3.5 rounded bg-[var(--text-secondary)]/20 text-[var(--text-secondary)] flex items-center justify-center font-extrabold text-[8px]">A</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default React.memo(McMenubarMock);
