import { create } from "zustand";

type ComposerFields = { title: string; content: string; tags: string[]; isPinned: boolean };
type ComposerDraft = ComposerFields & { creating: boolean; error: string | null };
const EMPTY_DRAFT: ComposerDraft = {
  title: "", content: "", tags: [], isPinned: false, creating: false, error: null,
};

// Keep unsaved creation attempts scoped to their originating workspace even
// when navigation unmounts the composer before its IPC completes.
export const useNoteComposerDraftStore = create<{ drafts: Record<string, ComposerDraft> }>(() => ({ drafts: {} }));

export function useNoteComposerDraft(workspaceId: string, onCreate: (fields: ComposerFields) => Promise<void>) {
  const draft = useNoteComposerDraftStore((state) => state.drafts[workspaceId] ?? EMPTY_DRAFT);
  const setDraft = (next: ComposerDraft) => {
    useNoteComposerDraftStore.setState((state) => ({ drafts: { ...state.drafts, [workspaceId]: next } }));
  };
  return {
    draft,
    update: (fields: Partial<ComposerFields>) => {
      const current = useNoteComposerDraftStore.getState().drafts[workspaceId] ?? EMPTY_DRAFT;
      if (!current.creating) { setDraft({ ...current, ...fields }); }
    },
    save: async () => {
      const current = useNoteComposerDraftStore.getState().drafts[workspaceId] ?? EMPTY_DRAFT;
      if (current.creating) { return false; }
      setDraft({ ...current, creating: true, error: null });
      try {
        if (current.title.trim() || current.content.trim()) {
          await onCreate({
            title: current.title.trim(), content: current.content.trim(),
            tags: current.tags, isPinned: current.isPinned,
          });
        }
        useNoteComposerDraftStore.setState((state) => {
          const drafts = { ...state.drafts };
          delete drafts[workspaceId];
          return { drafts };
        });
        return true;
      } catch (error) {
        setDraft({ ...current, creating: false, error: `Could not create note: ${String(error)}` });
        return false;
      }
    },
  };
}

window.addEventListener("beforeunload", (event) => {
  if (Object.values(useNoteComposerDraftStore.getState().drafts).some((draft) =>
    draft.title.trim() || draft.content.trim() || draft.creating)) {
    event.preventDefault();
    event.returnValue = "";
  }
});
