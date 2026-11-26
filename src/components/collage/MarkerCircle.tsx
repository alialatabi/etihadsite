import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Wraps content (a price) in a red hand-drawn marker loop. The loop is decorative (aria-hidden) and draws in once. */
export function MarkerCircle({ children, animate = true, className }: { children: ReactNode; animate?: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-block px-3 py-1', className)}>
      {children}
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 520 190"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-[-22%_-12%] h-[144%] w-[124%] overflow-visible text-brand"
      >
        <path
          d="M60 96 C40 34 270 6 420 26 C510 40 500 160 350 176 C210 190 50 172 56 92 C60 66 120 48 200 46"
          fill="none"
          stroke="currentColor"
          strokeWidth={4}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          pathLength={1}
          strokeDasharray={1}
          className={animate ? 'anim-draw' : undefined}
        />
      </svg>
    </span>
  );
}
