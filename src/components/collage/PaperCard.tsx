import type { ComponentPropsWithRef, ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { paperCardCls } from './classes';

type PaperCardProps = {
  as?: 'div' | 'section' | 'article' | 'li' | 'aside' | 'figure' | 'form';
  tone?: 'white' | 'grid' | 'news';
  /** A decorative tape strip on one top corner. */
  tape?: 'start' | 'end';
  className?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithRef<'div'>, 'className' | 'children'>;

/** A flat card for forms and data: white (or squared paper / newsprint), square corners, paper shadow. Never tilted. */
export function PaperCard({ as = 'div', tone = 'white', tape, className, children, ...rest }: PaperCardProps) {
  const Comp = as as ElementType;
  return (
    <Comp className={cn(paperCardCls(tone), className)} {...rest}>
      {tape ? (
        <span
          aria-hidden
          className={cn('tape-strip pointer-events-none absolute -top-3 h-6 w-20', tape === 'start' ? 'start-6 -rotate-6' : 'end-6 rotate-6')}
        />
      ) : null}
      {children}
    </Comp>
  );
}
