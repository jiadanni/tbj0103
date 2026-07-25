import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { History as HistoryIcon, ExternalLink } from "lucide-react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { ChatSession } from "../../stores/chatStore";
import { api } from "../../lib/api";
import { Tooltip } from "../Tooltip";
import { resolveWorkspaceSelection } from "../workspaceNav/workspaceNavShared";

function formatHistoryTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const HISTORY_MENU_WORKSPACE_TIMEOUT_MS = 1500;

async function getRecentSessionsForWorkspace(workspaceId: string, limit: number, includeDescendants: boolean) {
  const timeoutPromise = new Promise<ChatSession[]>((resolve) => {
    window.setTimeout(() => resolve([]), HISTORY_MENU_WORKSPACE_TIMEOUT_MS);
  });

  return Promise.race([
    api.chat.getRecentSessions(workspaceId, limit, { includeDescendants }).catch(() => [] as ChatSession[]),
    timeoutPromise,
  ]);
}

function mergeRecentSessions(sessions: ChatSession[]) {
  return Array.from(new Map(
    sessions
      .filter((session) => !session.is_deleted)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .map((session) => [session.id, session])
  ).values()).slice(0, 8);
}


function TitlebarHistoryMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const setActiveWorkspaceId = useWorkspaceStore((state) => state.setActiveWorkspaceId);
  const setActiveParentWorkspaceId = useWorkspaceStore((state) => state.setActiveParentWorkspaceId);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isHistoryRoute = location.pathname.startsWith("/history");
  const workspaceNames = React.useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open || workspaces.length === 0) {
      return;
    }

    let cancelled = false;
    let completed = 0;
    let aggregatedSessions: ChatSession[] = [];
    const stopLoadingTimer = window.setTimeout(() => {
      if (!cancelled) {
        setLoading(false);
      }
    }, HISTORY_MENU_WORKSPACE_TIMEOUT_MS + 200);

    workspaces.forEach((workspace) => {
      void getRecentSessionsForWorkspace(workspace.id, 8, workspace.parent_workspace_id == null)
        .then((recentSessions) => {
          if (cancelled) {
            return;
          }

          aggregatedSessions = mergeRecentSessions([
            ...aggregatedSessions,
            ...recentSessions,
          ]);
          setSessions(aggregatedSessions);
        })
        .finally(() => {
          completed += 1;
          if (!cancelled && completed >= workspaces.length) {
            window.clearTimeout(stopLoadingTimer);
            setLoading(false);
          }
        });
    });

    return () => {
      cancelled = true;
      window.clearTimeout(stopLoadingTimer);
    };
  }, [open, workspaces]);

  function openSession(sessionId: string, sessionWorkspaceId: string) {
    // Switch workspace first if the session belongs to a different one.
    // Without this, ChatView would detect the session isn't in the current
    // workspace and immediately clear the route.
    if (sessionWorkspaceId && sessionWorkspaceId !== activeWorkspaceId) {
      const { workspaceId, parentWorkspaceId } = resolveWorkspaceSelection(workspaces, sessionWorkspaceId);
      if (workspaceId) {
        setActiveParentWorkspaceId(parentWorkspaceId);
        setActiveWorkspaceId(workspaceId);
      }
    }
    navigate(`/chat/${sessionId}`);
    setOpen(false);
  }

  function openFullHistory() {
    navigate("/history");
    setOpen(false);
  }

  function toggleMenu() {
    const nextOpen = !open;
    if (nextOpen) {
      setLoading(workspaces.length > 0);
      if (workspaces.length === 0) {
        setSessions([]);
      }
    } else {
      setLoading(false);
    }
    setOpen(nextOpen);
  }

  return (
    <div ref={rootRef} className="relative">
      <Tooltip content="History" position="bottom">
        <button
          onClick={toggleMenu}
          title="History"
          aria-label="Open History"
          aria-haspopup="menu"
          aria-expanded={open}
          className={`flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-medium transition-colors ${
            open || isHistoryRoute
              ? "border-[var(--accent-color)] bg-[var(--accent-color)] text-white"
              : "border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
          }`}
        >
          <HistoryIcon size={15} />
        </button>
      </Tooltip>

      {open && (
        <div
          role="menu"
          aria-label="History menu"
          className="absolute right-0 top-10 z-50 w-80 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-xl"
        >
          <div className="border-b border-[var(--border-color)] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-[var(--text-primary)]">Recent history</div>
              {loading ? <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">Refreshing</div> : null}
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              {workspaces.length > 0 ? "Recent chats across all workspaces" : "Open a workspace to see recent chats"}
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto p-2">
            {sessions.length === 0 ? (
              <div className="px-2 py-6 text-center text-sm text-[var(--text-muted)]">
                {loading ? "Loading recent chats…" : "No recent chats yet."}
              </div>
            ) : (
              sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  role="menuitem"
                  onClick={() => openSession(session.id, session.workspace_id)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
                >
                  <HistoryIcon size={14} className="shrink-0 text-[var(--text-muted)]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                      {session.title || "Untitled"}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--text-muted)]">
                      <span className="truncate">{workspaceNames.get(session.workspace_id) ?? "Workspace"}</span>
                      <span>{formatHistoryTimestamp(session.updated_at)}</span>
                      {session.model_name ? <span className="truncate opacity-70">{session.model_name}</span> : null}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="border-t border-[var(--border-color)] p-2">
            <button
              type="button"
              role="menuitem"
              onClick={openFullHistory}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
            >
              <span>Show full history</span>
              <ExternalLink size={14} className="shrink-0 text-[var(--text-muted)]" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { TitlebarHistoryMenu };
