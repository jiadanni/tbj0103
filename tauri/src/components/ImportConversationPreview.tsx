import { CheckSquare, Square } from "lucide-react";
import { useSettingsStore } from "../stores/settingsStore";

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, { dateStyle: "short" });

export interface ImportConversation {
  uuid: string;
  name: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  first_user_message?: string;
  messages?: { role: string; content: string }[];
}

interface Props {
  conversations: ImportConversation[];
  selected: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  focusedUuid: string | null;
  onFocusChange: (uuid: string | null) => void;
  /** Label shown in the message bubbles for the assistant role */
  assistantLabel?: string;
}

export default function ImportConversationPreview({
  conversations,
  selected,
  onSelectionChange,
  focusedUuid,
  onFocusChange,
  assistantLabel,
}: Props) {
  const userChatLabel = useSettingsStore((s) => s.userChatLabel);
  const assistantChatLabel = useSettingsStore((s) => s.assistantChatLabel);
  const displayAssistantLabel = assistantLabel ?? assistantChatLabel;

  const focused = focusedUuid ? conversations.find((c) => c.uuid === focusedUuid) : null;

  return (
    <div className="flex gap-3 min-h-0 flex-1">
      {/* ── Conversation list with checkboxes ── */}
      <div className="flex flex-col gap-2 min-w-0 w-[55%] max-w-[55%]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--text-primary)]">
            Conversations ({selected.size}/{conversations.length})
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => onSelectionChange(new Set(conversations.map((c) => c.uuid)))}
              className="text-xs text-[var(--accent-color)] hover:underline"
            >
              All
            </button>
            <button
              onClick={() => onSelectionChange(new Set())}
              className="text-xs text-[var(--text-muted)] hover:underline"
            >
              None
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]">
          {conversations.map((conversation) => {
            const checked = selected.has(conversation.uuid);
            const isFocused = conversation.uuid === focusedUuid;
            return (
              <div
                key={conversation.uuid}
                onClick={() => onFocusChange(conversation.uuid)}
                className={`flex cursor-pointer items-center gap-2.5 border-b border-[var(--border-color)] px-3 py-2 last:border-b-0 hover:bg-[var(--bg-hover)] ${isFocused ? "bg-[var(--accent-color)]/10" : ""}`}
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = new Set(selected);
                    if (checked) { next.delete(conversation.uuid); }
                    else { next.add(conversation.uuid); }
                    onSelectionChange(next);
                  }}
                  className="shrink-0 text-[var(--accent-color)]"
                >
                  {checked ? <CheckSquare size={16} /> : <Square size={16} className="text-[var(--text-muted)]" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-[var(--text-primary)]">
                    {conversation.name || "Untitled"}
                  </p>
                  {conversation.first_user_message && conversation.first_user_message !== conversation.name && (
                    <p className="truncate text-[10px] text-[var(--text-secondary)]">
                      {conversation.first_user_message}
                    </p>
                  )}
                  <p className="truncate text-[10px] text-[var(--text-muted)]">
                    {conversation.message_count} msg{conversation.message_count !== 1 && "s"}
                    {" · "}
                    {SHORT_DATE_FORMATTER.format(new Date(conversation.created_at))}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Message preview pane ── */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col gap-2 overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
        {!focused ? (
          <div className="m-auto text-[11px] text-[var(--text-muted)]">Select a conversation to preview.</div>
        ) : (
          <>
            <div className="text-sm font-medium text-[var(--text-primary)] truncate">{focused.name || "Untitled"}</div>
            <div className="text-[11px] text-[var(--text-muted)]">
              {focused.message_count} message{focused.message_count === 1 ? "" : "s"}
              {focused.updated_at && ` · ${SHORT_DATE_FORMATTER.format(new Date(focused.updated_at))}`}
            </div>
            {focused.messages && focused.messages.length > 0 ? (
              <div className="mt-1 flex-1 min-h-0 overflow-y-auto rounded-md border border-[var(--border-color)]">
                {focused.messages.map((msg, i) => (
                  <div key={i} className={`flex flex-col gap-0.5 border-b border-[var(--border-color)] px-3 py-2 last:border-b-0 ${msg.role === "user" ? "bg-[var(--bg-elevated)]" : "bg-[var(--bg-primary)]"}`}>
                    <span className="text-[10px] font-medium text-[var(--text-muted)]">{msg.role === "user" ? userChatLabel : displayAssistantLabel}</span>
                    <p className="whitespace-pre-wrap text-[11px] text-[var(--text-secondary)]">{msg.content}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-1 text-[11px] text-[var(--text-muted)]">No message preview available.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
