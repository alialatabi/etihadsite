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
        'rounded-md px-2 py-1.5 transition-colors hover:text-primary',
        active ? 'font-bold text-primary underline decoration-brand decoration-2 underline-offset-8' : 'text-foreground/80',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </Link>
  );
}
