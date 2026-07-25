export function Toggle({ on, onToggle, disabled = false }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!disabled) {
          onToggle();
        }
      }}
      role="checkbox"
      aria-checked={on}
      aria-disabled={disabled}
      disabled={disabled}
      className={`w-[18px] h-[18px] rounded-[4px] border transition-colors flex items-center justify-center flex-shrink-0 ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      } ${
        on
          ? "bg-[var(--accent-color)] border-[var(--accent-color)]"
          : "bg-transparent border-[var(--border-color)] hover:border-[var(--text-muted)]"
      }`}
    >
      {on && (
        <svg viewBox="0 0 16 16" className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 8 7 12 13 4" />
        </svg>
      )}
    </button>
  );
}
