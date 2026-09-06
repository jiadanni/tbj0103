import type { ReactNode } from "react";

/**
 * The app's surface primitives.
 *
 * Every card, panel and control in the app should come from here rather than
 * re-deriving `border + background + shadow` at the call site. The visual
 * definition lives in exactly two places:
 *
 *   - `globals.css`      — the `--surface-*` tokens and `.surface-card` helpers
 *   - `tailwind.config`  — the `--radius-*` tokens behind `rounded-*`
 *
 * so retuning the app's look is an edit to those, not a sweep across call
 * sites. Adopt these opportunistically: when you touch a file for another
 * reason, swap its hand-rolled surfaces over.
 */

type Div = React.HTMLAttributes<HTMLDivElement>;

/**
 * A page- or section-level container. The outermost chrome on a view.
 */
export function Panel({
  children,
  className = "",
  ...rest
}: { children: ReactNode; className?: string } & Div) {
  return (
    <section className={`surface-card rounded-xl px-4 py-3 ${className}`} {...rest}>
      {children}
    </section>
  );
}

/**
 * A card nested inside a Panel. Same surface, tighter padding.
 */
export function Card({
  children,
  className = "",
  ...rest
}: { children: ReactNode; className?: string } & Div) {
  return (
    <div className={`surface-card rounded-xl p-3 ${className}`} {...rest}>
      {children}
    </div>
  );
}

/**
 * A whole card that is itself a click target. Composes the interactive
 * modifier, which supplies the hover background and accent border — do not
 * hand-write `hover:` utilities on top of it.
 */
export function CardButton({
  children,
  className = "",
  ...rest
}: { children: ReactNode; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`surface-card surface-card-interactive rounded-xl p-3 text-left ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * The small uppercase label above a section's content.
 *
 * Standardised on 11px / 0.12em: the app had four different letter-spacings
 * for this one motif, often on the same screen.
 */
export function Eyebrow({
  children,
  className = "",
  ...rest
}: { children: ReactNode; className?: string } & Div) {
  return (
    <div
      className={`text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)] ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
