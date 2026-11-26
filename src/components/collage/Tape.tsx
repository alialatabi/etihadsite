import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { TILT, type Tilt } from './classes';

/**
 * Orange tape. With `children`: a label (navy text, never white). Without: a decorative strip
 * (`orange` or `clear`, aria-hidden), placed on corners only. Server-safe.
 */
export function Tape({
  children,
  strip = 'orange',
  tilt = -2,
  className,
}: {
  children?: ReactNode;
  strip?: 'orange' | 'clear';
  tilt?: Tilt;
  className?: string;
}) {
  if (children) {
    return <span className={cn('inline-block bg-tape px-4 py-1.5 text-[15px] font-bold leading-snug text-ink', TILT[tilt], className)}>{children}</span>;
  }
  return <span aria-hidden className={cn('pointer-events-none block h-6 w-20', strip === 'clear' ? 'tape-clear' : 'tape-strip', TILT[tilt], className)} />;
}
