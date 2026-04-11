import React, { useState, useRef, useEffect } from "react";
import { Menu, Plus, FileText, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function AppHeaderMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleAction = (action: () => void) => {
    action();
    setIsOpen(false);
  };

  return (
    <div className="relative mr-2 flex-shrink-0" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-9 h-10 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded hover:bg-[var(--bg-hover)]"
        title="App Menu"
      >
        <Menu size={20} />
      </button>

      {isOpen && (
        <div className="absolute top-10 left-0 z-50 w-48 rounded-lg shadow-xl bg-[var(--bg-elevated)] border border-[var(--border-color)] overflow-hidden">
          <div className="py-1">
            <button
              onClick={() => handleAction(() => {
                 navigate("/chat", { replace: true, state: { createNewChat: true } });
              })}
              className="w-full text-left px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] flex items-center gap-2"
            >
              <Plus size={14} /> New Chat
            </button>
            <button
              onClick={() => handleAction(() => {
                 navigate("/notes", { replace: true });
                 window.dispatchEvent(new CustomEvent("new-note-command"));
              })}
              className="w-full text-left px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] flex items-center gap-2"
            >
              <FileText size={14} /> New Note
            </button>
            <div className="h-px bg-[var(--border-color)] my-1"></div>
            <button
              onClick={() => handleAction(() => navigate("/preferences", { replace: true }))}
              className="w-full text-left px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] flex items-center gap-2"
            >
              <Settings size={14} /> Preferences...
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
