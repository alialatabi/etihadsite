/**
 * Arrow-key navigation for a hand-made `role="radiogroup"` in an RTL page.
 * ArrowLeft / ArrowDown go to the NEXT option and ArrowRight / ArrowUp to the PREVIOUS one (the options run right to
 * left), wrapping at both ends. Returns null for any other key, so the caller leaves it alone.
 */
export function nextRadioIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === 'ArrowLeft' || key === 'ArrowDown') return (index + 1) % count;
  if (key === 'ArrowRight' || key === 'ArrowUp') return (index - 1 + count) % count;
  return null;
}

/** Roving tabindex: only the selected option (or the first one while nothing is selected) is a Tab stop. */
export function radioTabIndex(index: number, selectedIndex: number): 0 | -1 {
  return index === (selectedIndex < 0 ? 0 : selectedIndex) ? 0 : -1;
}
