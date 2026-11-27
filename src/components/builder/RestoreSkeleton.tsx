/**
 * Placeholder shown over the (invisible) builder column while a saved order is being brought back.
 * Purely visual: aria-hidden, no text, absolutely positioned inside the column so layout and focus order
 * are untouched. `visible` re-shows it inside the `invisible` column; `motion-safe:` keeps reduced-motion users still.
 */
export function RestoreSkeleton() {
  return <div aria-hidden="true" className="paper-card visible pointer-events-none absolute inset-0 bg-news/60 motion-safe:animate-pulse" />;
}
