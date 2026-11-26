'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** The only client component in the shell: marks the current page's link. */
export function NavLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      // Plain join, not cn(): the only cn user in the root layout's client bundle, and these classes never conflict.
      className={[
        'inline-flex min-h-11 items-center rounded-[2px] px-2 transition-colors hover:text-ink focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink',
        active ? 'font-bold text-ink underline decoration-ink decoration-[3px] underline-offset-8' : 'text-ink-soft',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </Link>
  );
}
