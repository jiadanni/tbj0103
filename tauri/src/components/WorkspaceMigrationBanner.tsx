import React, { useEffect, useState } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";

export const WorkspaceMigrationBanner: React.FC = () => {
  const { migrationSuggestion, dismissMigrationSuggestion, setActiveWorkspaceId } = useWorkspaceStore();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (migrationSuggestion && !migrationSuggestion.is_match && migrationSuggestion.suggestion) {
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
        dismissMigrationSuggestion();
      }, 10000);
      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [migrationSuggestion, dismissMigrationSuggestion]);

  if (!visible || !migrationSuggestion?.suggestion) return null;

  const handleSwitch = () => {
    setActiveWorkspaceId(migrationSuggestion.suggestion!.workspace_id);
    dismissMigrationSuggestion();
    setVisible(false);
  };

  const handleDismiss = () => {
    dismissMigrationSuggestion();
    setVisible(false);
  };

  return (
    <div className="flex items-center justify-between p-3 mt-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm text-amber-600 dark:text-amber-400 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>This message might fit better in <span className="font-semibold">{migrationSuggestion.suggestion.workspace_name}</span></span>
      </div>
      <div className="flex items-center gap-3 border-l border-amber-500/20 pl-3">
        <button onClick={handleSwitch} className="font-medium hover:underline focus:outline-none focus:ring-2 ring-amber-500 rounded px-1">Switch</button>
        <button onClick={handleDismiss} className="opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 ring-amber-500 rounded">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
};
