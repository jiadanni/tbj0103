import React, { useEffect } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";

interface WorkspaceMigrationBannerProps {
  /** Called when the user explicitly dismisses the banner (not on auto-timeout). */
  onDismiss?: () => void;
  /** Called when the user chooses to move the current chat to the suggested workspace. */
  onMove?: (targetWorkspaceId: string) => void;
}

export const WorkspaceMigrationBanner: React.FC<WorkspaceMigrationBannerProps> = ({ onDismiss, onMove }) => {
  const { migrationSuggestion, dismissMigrationSuggestion } = useWorkspaceStore();
  const shouldShow = !!migrationSuggestion && !migrationSuggestion.is_match && !!migrationSuggestion.suggestion;

  useEffect(() => {
    if (migrationSuggestion && !migrationSuggestion.is_match && migrationSuggestion.suggestion) {
      const timer = setTimeout(() => {
        dismissMigrationSuggestion();
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [migrationSuggestion, dismissMigrationSuggestion]);

  if (!shouldShow || !migrationSuggestion?.suggestion) {return null;}

  const handleMove = () => {
    if (migrationSuggestion.suggestion) {
      onMove?.(migrationSuggestion.suggestion.workspace_id);
    }
    dismissMigrationSuggestion();
  };

  const handleDismiss = () => {
    dismissMigrationSuggestion();
    onDismiss?.();
  };

  return (
    <div className="flex items-center justify-between mx-4 mt-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm text-amber-600 dark:text-amber-400 animate-in fade-in slide-in-from-top-2">
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>This chat might fit better in <span className="font-semibold">{migrationSuggestion.suggestion.workspace_name}</span></span>
      </div>
      <div className="flex items-center gap-3 border-l border-amber-500/20 pl-3">
        <button onClick={handleMove} className="font-medium hover:underline focus:outline-none focus:ring-2 ring-amber-500 rounded px-1">Move</button>
        <button onClick={handleDismiss} className="opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 ring-amber-500 rounded">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
};
