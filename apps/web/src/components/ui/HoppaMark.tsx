/**
 * Hoppa's "hop" brand mark — a dashed arc (the hop trajectory) with the
 * hopper at its apex, matching the logo on the marketing site (hoppa.io).
 *
 * Draws in `currentColor`, so it inherits the surrounding text color (e.g.
 * white when placed on a brand-colored tile). Size it with a `className`
 * (`w-7 h-7`, etc.).
 */
export function HoppaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 26 26" fill="none" className={className} aria-hidden="true">
      <path
        d="M3 22 C 7 6, 19 6, 23 22"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="2.5 4"
        fill="none"
      />
      <circle cx="13" cy="7.5" r="2.6" fill="currentColor" />
    </svg>
  );
}
