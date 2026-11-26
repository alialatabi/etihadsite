import { Fragment, type ElementType, type Ref } from 'react';
import { cn } from '@/lib/utils';
import { scrapCls, TILT, type ScrapFont, type ScrapTone, type Tilt } from './classes';

const PALETTE: { tone: ScrapTone; font: ScrapFont }[] = [
  { tone: 'white', font: 'kufi' },
  { tone: 'navy', font: 'rakkas' },
  { tone: 'news', font: 'lalezar' },
];
const TILTS: Tilt[] = [-3, 2, -2, 3, -1];

/** Splits `text` into at most `max` consecutive word groups, as even as possible. */
function chunk(text: string, max: number): string[] {
  const words = text.split(' ');
  if (words.length <= max) return words;
  const out: string[] = [];
  let at = 0;
  for (let i = 0; i < max; i++) {
    const take = Math.ceil((words.length - at) / (max - i));
    out.push(words.slice(at, at + take).join(' '));
    at += take;
  }
  return out;
}

/**
 * A page headline as torn scraps, one word per scrap (grouped above `maxScraps`), exactly one on red.
 * ONE heading element: its text and accessible name equal `text`. Server-safe.
 */
export function ScrapHeadline({
  text,
  as = 'h1',
  red = 'last',
  size = 'md',
  maxScraps = 5,
  animate = false,
  className,
  id,
  tabIndex,
  ref,
}: {
  text: string;
  as?: 'h1' | 'h2' | 'p';
  red?: 'last' | 'first' | 'none' | number;
  size?: 'md' | 'lg' | 'xl';
  maxScraps?: number;
  animate?: boolean;
  className?: string;
  id?: string;
  tabIndex?: number;
  ref?: Ref<HTMLHeadingElement>;
}) {
  const Comp = as as ElementType;
  const chunks = chunk(text, Math.max(1, maxScraps));
  const redIndex =
    red === 'none' ? -1 : red === 'last' ? chunks.length - 1 : red === 'first' ? 0 : Math.min(Math.max(0, red), chunks.length - 1);
  let plain = 0;
  return (
    <Comp ref={ref} id={id} tabIndex={tabIndex} className={cn('font-normal leading-[1.9]', className)}>
      {chunks.map((c, i) => {
        const look = i === redIndex ? { tone: 'red' as const, font: 'lalezar' as const } : PALETTE[plain++ % PALETTE.length];
        return (
          <Fragment key={i}>
            {i > 0 && ' '}
            <span
              className={cn(scrapCls({ ...look, size }), 'my-1 align-middle', TILT[TILTS[i % TILTS.length]], animate && 'anim-slap')}
              style={animate ? { animationDelay: `${i * 120}ms` } : undefined}
            >
              {c}
            </span>
          </Fragment>
        );
      })}
    </Comp>
  );
}
