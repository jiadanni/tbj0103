import { useEffect } from "react";
import { create } from "zustand";
import { api, type ProjectNote } from "../lib/api";

type NoteFields = Pick<ProjectNote, "title" | "content" | "tags" | "is_pinned">;
type NoteDraft = {
  workspaceId: string;
  fields: NoteFields;
  revision: number;
  dirty: boolean;
  saving: boolean;
  error: string | null;
};

// Memory-only: plaintext browser storage would bypass database encryption.
// The queue outlives editors, so navigation cannot cancel pending writes.
export const useNoteDraftStore = create<{ drafts: Record<string, NoteDraft> }>(() => ({ drafts: {} }));
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const saves = new Map<string, Promise<boolean>>();

function noteFields(fields: NoteFields): NoteFields {
  return { title: fields.title, content: fields.content, tags: fields.tags ?? [], is_pinned: fields.is_pinned };
}

export function refreshNoteDrafts(notes: ProjectNote[], draftsAtLoad: Record<string, NoteDraft>) {
  useNoteDraftStore.setState((state) => {
    const drafts = { ...state.drafts };
    for (const note of notes) {
      const draft = drafts[note.id];
      if (draft && !draft.dirty && draft === draftsAtLoad[note.id]) {
        drafts[note.id] = { ...draft, fields: noteFields(note) };
      }
    }
    return { drafts };
  });
}

function patchDraft(id: string, fields: Partial<NoteDraft>) {
  useNoteDraftStore.setState((state) => {
    const draft = state.drafts[id];
    return draft ? { drafts: { ...state.drafts, [id]: { ...draft, ...fields } } } : state;
  });
}

export function flushNoteDraft(id: string): Promise<boolean> {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const pending = saves.get(id);
  if (pending) { return pending; }

  const save = async () => {
    while (true) {
      const draft = useNoteDraftStore.getState().drafts[id];
      if (!draft?.dirty) { return true; }
      patchDraft(id, { saving: true, error: null });
      try {
        await api.note.update(id, draft.fields);
      } catch (error) {
        patchDraft(id, { saving: false, error: `Could not save note: ${String(error)}` });
        return false;
      }
      const latest = useNoteDraftStore.getState().drafts[id];
      if (latest?.revision === draft.revision) {
        patchDraft(id, { dirty: false, saving: false });
        return true;
      }
      // A newer revision is sent only after the older IPC has finished.
    }
  };
  const promise = save().finally(() => { saves.delete(id); });
  saves.set(id, promise);
  return promise;
}

export function discardNoteDraft(id: string) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  useNoteDraftStore.setState((state) => {
    const drafts = { ...state.drafts };
    delete drafts[id];
    return { drafts };
  });
}

export function updateNoteDraft(note: ProjectNote, fields: NoteFields) {
  const previous = useNoteDraftStore.getState().drafts[note.id];
  useNoteDraftStore.setState((state) => ({
    drafts: {
      ...state.drafts,
      [note.id]: {
        workspaceId: note.workspace_id,
        fields: noteFields(fields),
        revision: (previous?.revision ?? 0) + 1,
        dirty: true,
        saving: previous?.saving ?? false,
        error: previous?.error ?? null,
      },
    },
  }));
  clearTimeout(timers.get(note.id));
  timers.set(note.id, setTimeout(() => { void flushNoteDraft(note.id); }, 1200));
}

export function useNoteDraft(note: ProjectNote) {
  const draft = useNoteDraftStore((state) => state.drafts[note.id]);
  useEffect(() => () => { void flushNoteDraft(note.id); }, [note.id]);

  return {
    fields: draft?.fields ?? note,
    dirty: draft?.dirty ?? false,
    saving: draft?.saving ?? false,
    error: draft?.error ?? null,
    flush: () => flushNoteDraft(note.id),
    update: (fields: NoteFields) => updateNoteDraft(note, fields),
  };
}

window.addEventListener("beforeunload", (event) => {
  const pending = Object.entries(useNoteDraftStore.getState().drafts).filter(([, draft]) => draft.dirty);
  if (pending.length === 0) { return; }
  pending.forEach(([id]) => { void flushNoteDraft(id); });
  // Webviews may ignore this warning; force quit cannot guarantee a flush.
  event.preventDefault();
  event.returnValue = "";
});
