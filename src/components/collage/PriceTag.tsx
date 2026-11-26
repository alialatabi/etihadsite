import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { MarkerCircle } from './MarkerCircle';
import { TILT, type Tilt } from './classes';

/** A price on a white card: label in Plex bold, amount in Lalezar, optional marker circle and tape on the corner. */
export function PriceTag({
  label,
  children,
  marker,
  tape,
  tilt = 2,
  className,
}: {
  label?: ReactNode;
  /** The amount, e.g. `<Money/>`. */
  children: ReactNode;
  marker?: boolean;
  tape?: boolean;
  tilt?: Tilt;
  className?: string;
}) {
  const amount = <span className="block font-lalezar text-[34px] font-normal leading-[1.15] text-ink">{children}</span>;
  return (
    <div className={cn('paper-card relative inline-block px-5 pt-3 pb-4', TILT[tilt], className)}>
      {tape ? <span aria-hidden className="tape-strip pointer-events-none absolute -top-3 start-1/3 h-6 w-20 -rotate-6" /> : null}
      {label ? <span className="block text-[15px] font-bold text-ink">{label}</span> : null}
      {marker ? <MarkerCircle>{amount}</MarkerCircle> : amount}
    </div>
  );
}
