import type { ReactNode } from 'react';

/**
 * Isolates left-to-right content (numbers, units, file names, phone numbers,
 * order ids, "3 × 4.2") inside RTL text so the bidi algorithm cannot reorder it.
 * Always wrap mixed Latin/digit strings with this.
 */
export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={className ? `tabular-nums ${className}` : 'tabular-nums'}>
      {children}
    </bdi>
  );
}
