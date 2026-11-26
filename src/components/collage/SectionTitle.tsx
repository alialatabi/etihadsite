import type { ElementType, ReactNode, Ref } from 'react';
import { cn } from '@/lib/utils';
import { scrapCls, TILT, type Tilt } from './classes';

/** A section heading as ONE Lalezar scrap (the text is not split). Navy by default. Server-safe. */
export function SectionTitle({
  as = 'h2',
  tone = 'navy',
  size = 'md',
  tilt = -1.5,
  id,
  tabIndex,
  ref,
  className,
  children,
}: {
  as?: 'h1' | 'h2' | 'h3';
  tone?: 'navy' | 'white' | 'red';
  size?: 'sm' | 'md';
  tilt?: Tilt;
  id?: string;
  tabIndex?: number;
  ref?: Ref<HTMLHeadingElement>;
  className?: string;
  children: ReactNode;
}) {
  const Comp = as as ElementType;
  return (
    <Comp ref={ref} id={id} tabIndex={tabIndex} className={cn(scrapCls({ tone, font: 'lalezar', size }), 'inline-block', TILT[tilt], className)}>
      {children}
    </Comp>
  );
}
