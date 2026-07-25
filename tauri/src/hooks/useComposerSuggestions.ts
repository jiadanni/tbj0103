import { useCallback, useMemo, useState } from "react";
import {
  buildChatSuggestionRow,
  buildWorkspaceSuggestionRow,
  type ComposerSuggestion,
  type ComposerSuggestionRow,
} from "../lib/composerSuggestions";
import { api, type TopicSignature } from "../lib/api";
import type { Message } from "../stores/chatStore";
import type { Folder, Workspace } from "../stores/workspaceStore";

export interface UseComposerSuggestionsArgs {
  activeWorkspace: Workspace | null;
  activeFolder: Folder | null;
  activeTopicSignature: TopicSignature | null | undefined;
  promptBankPrompts: string[];
  attachedSourcesCount: number;
  activeMessages: Message[];
  followUps: string[];
  showComposerWorkspaceSuggestions: boolean;
  showComposerChatFollowUps: boolean;
  activeChatId: string | null | undefined;
  effectiveWorkspaceId: string | null | undefined;
}

export interface UseComposerSuggestionsResult {
  composerWorkspaceRow: ComposerSuggestionRow | null;
  chatFollowUpRow: ComposerSuggestionRow | null;
  composerSuggestionRows: ComposerSuggestionRow[];
  isComposerHeaderCollapsed: boolean;
  setIsComposerHeaderCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  hasComposerHeader: boolean;
  showComposerHeader: boolean;
  waterfallSuggestions: ComposerSuggestion[];
  handleDismissSuggestion: (suggestion: ComposerSuggestion) => void;
}

export function useComposerSuggestions({
  activeWorkspace,
  activeFolder,
  activeTopicSignature,
  promptBankPrompts,
  attachedSourcesCount,
  activeMessages,
  followUps,
  showComposerWorkspaceSuggestions,
  showComposerChatFollowUps,
  activeChatId,
  effectiveWorkspaceId,
}: UseComposerSuggestionsArgs): UseComposerSuggestionsResult {
  const suggestionContext = useMemo(() => ({
    workspaceName: activeWorkspace?.name ?? null,
    folderName: activeFolder?.name ?? null,
    topicSignature: activeTopicSignature,
    promptBankPrompts,
    processedDocCount: attachedSourcesCount,
    activeMessages,
    followUps,
  }), [
    activeWorkspace,
    activeFolder,
    activeTopicSignature,
    promptBankPrompts,
    attachedSourcesCount,
    activeMessages,
    followUps,
  ]);

  const composerWorkspaceRow = useMemo(() => {
    if (!showComposerWorkspaceSuggestions) {return null;}
    return buildWorkspaceSuggestionRow(suggestionContext);
  }, [showComposerWorkspaceSuggestions, suggestionContext]);

  const chatFollowUpRow = useMemo(() => {
    if (!showComposerChatFollowUps) {return null;}
    return buildChatSuggestionRow(suggestionContext);
  }, [showComposerChatFollowUps, suggestionContext]);

  const composerSuggestionRows = useMemo(
    () => (composerWorkspaceRow ? [composerWorkspaceRow] : []),
    [composerWorkspaceRow],
  );
  const [isComposerHeaderCollapsed, setIsComposerHeaderCollapsed] = useState(false);
  const hasComposerHeader = composerSuggestionRows.length > 0;
  const showComposerHeader = hasComposerHeader && !isComposerHeaderCollapsed;

  // Locally suppress prompts the user has dismissed (X'd) this session so they
  // disappear immediately regardless of source (bank / AI / fallback). The
  // dismissal is also persisted to the backend as negative feedback below.
  const [dismissedPromptKeys, setDismissedPromptKeys] = useState<Set<string>>(() => new Set());

  const waterfallSuggestions = useMemo(() => {
    if (activeChatId) { return []; }
    const all = composerSuggestionRows.flatMap(row => row.suggestions);
    if (dismissedPromptKeys.size === 0) { return all; }
    return all.filter((s) => !dismissedPromptKeys.has(s.prompt.trim().toLowerCase()));
  }, [activeChatId, composerSuggestionRows, dismissedPromptKeys]);

  const handleDismissSuggestion = useCallback((suggestion: ComposerSuggestion) => {
    setDismissedPromptKeys((prev) => {
      const next = new Set(prev);
      next.add(suggestion.prompt.trim().toLowerCase());
      return next;
    });
    if (effectiveWorkspaceId) {
      void api.workspace.dismissPromptSuggestion(effectiveWorkspaceId, suggestion.prompt);
    }
  }, [effectiveWorkspaceId]);

  return {
    composerWorkspaceRow,
    chatFollowUpRow,
    composerSuggestionRows,
    isComposerHeaderCollapsed,
    setIsComposerHeaderCollapsed,
    hasComposerHeader,
    showComposerHeader,
    waterfallSuggestions,
    handleDismissSuggestion,
  };
}
