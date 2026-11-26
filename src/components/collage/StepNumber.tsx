import type { ReactNode } from 'react';
import { Ltr } from '@/components/Ltr';
import { cn } from '@/lib/utils';

const SIZE = {
  sm: 'size-8 text-lg shadow-[0_0_0_3px_#fff,0_4px_8px_rgb(30_24_12/0.25)]',
  md: 'size-11 text-2xl shadow-[0_0_0_4px_#fff,0_6px_10px_rgb(30_24_12/0.25)]',
  lg: 'size-14 text-[30px] shadow-[0_0_0_5px_#fff,0_6px_10px_rgb(30_24_12/0.25)]',
} as const;
const TONE = { red: 'bg-brand text-white', navy: 'bg-ink text-paper', white: 'bg-white text-ink' } as const;

/** A numbered circle with a white ring: Lalezar digit (Western, in `<Ltr>`). Pass `n` or `children`. */
export function StepNumber({
  n,
  children,
  tone = 'red',
  size = 'md',
  className,
}: {
  n?: number;
  children?: ReactNode;
  tone?: keyof typeof TONE;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-[50%] font-lalezar font-normal leading-none', SIZE[size], TONE[tone], className)}>
      {children ?? <Ltr>{n}</Ltr>}
    </span>
  );
}
