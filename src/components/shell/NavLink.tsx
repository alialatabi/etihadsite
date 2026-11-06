'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** The only client component in the shell: marks the current page's link. */
export function NavLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded-md px-2 py-1.5 transition-colors hover:text-primary',
        active ? 'font-bold text-primary underline decoration-brand decoration-2 underline-offset-8' : 'text-foreground/80',
        className,
      )}
    >
      {children}
    </Link>
  );
}
