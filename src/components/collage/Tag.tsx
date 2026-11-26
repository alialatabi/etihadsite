import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { tagCls, TILT, type ScrapTone, type Tilt } from './classes';

/** A small torn label (14px bold Plex), for badges and counts. Server-safe. */
export function Tag({
  tone = 'navy',
  tilt = 0,
  as = 'span',
  className,
  children,
}: {
  tone?: ScrapTone;
  tilt?: Tilt;
  as?: 'span' | 'p';
  className?: string;
  children: ReactNode;
}) {
  const Comp = as as ElementType;
  return <Comp className={cn(tagCls(tone), TILT[tilt], className)}>{children}</Comp>;
}
