import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

const CTA_BASE =
  'inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-brand px-6 font-bold text-brand-foreground transition-colors hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/**
 * The brand call-to-action link with the "next" arrow, shared by /how-it-works and the 404 page.
 * Server component. Spacing and text size come from the caller through `className`.
 */
export function CtaLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cn(CTA_BASE, className)}>
      {children}
      <ArrowLeft className="size-5" aria-hidden />
    </Link>
  );
}
