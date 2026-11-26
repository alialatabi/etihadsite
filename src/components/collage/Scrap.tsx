import type { ComponentPropsWithRef, ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { scrapCls, TILT, type ScrapEdge, type ScrapFont, type ScrapSize, type ScrapTone, type Tilt } from './classes';

type ScrapProps = {
  as?: 'span' | 'p' | 'div' | 'h1' | 'h2' | 'h3' | 'li';
  tone?: ScrapTone;
  font?: ScrapFont;
  edge?: ScrapEdge;
  size?: ScrapSize;
  tilt?: Tilt;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithRef<'div'>, 'className' | 'children'>;

/** One element = one torn paper scrap (tone, font, edge, size, tilt). Server-safe. */
export function Scrap({ as = 'span', tone, font, edge, size, tilt = 0, className, children, ...rest }: ScrapProps) {
  const Comp = as as ElementType;
  return (
    <Comp className={cn(scrapCls({ tone, font, edge, size }), TILT[tilt], className)} {...rest}>
      {children}
    </Comp>
  );
}
