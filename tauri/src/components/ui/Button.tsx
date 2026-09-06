import type { ReactNode } from "react";

/**
 * The canonical button.
 *
 * The app had the same accent button in eight different geometries
 * (`rounded-xl px-4 py-2`, `rounded-lg px-3 py-1.5`, `rounded-lg px-3 py-2`, …).
 * `rounded-lg px-3 py-1.5` is the joint-most common of those and uses the
 * majority radius, so standardising here moves the fewest pixels.
 *
 * Sizing note: `rounded-lg` resolves to `--radius-control`, shared with Input,
 * so a button and its adjacent input agree by construction.
 */

type Variant = "accent" | "outline" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  accent:
    "bg-[var(--accent-color)] text-white hover:bg-[var(--accent-color)]/90 disabled:opacity-50",
  outline:
    "surface-card text-[var(--text-primary)] hover:border-[var(--accent-color)] disabled:opacity-50",
  ghost:
    "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-50",
  danger:
    "border border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50",
};

export function Button({
  children,
  variant = "outline",
  className = "",
  ...rest
}: {
  children: ReactNode;
  variant?: Variant;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * The canonical text input. Shares `--radius-control` with Button.
 */
export function Input({
  className = "",
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`rounded-lg border border-[var(--surface-border)] bg-[var(--bg-input)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-color)] ${className}`}
      {...rest}
    />
  );
}
