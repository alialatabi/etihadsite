import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { ctaCls } from '@/components/collage';
import { cn } from '@/lib/utils';

/**
 * The main call-to-action link with the "next" arrow (points left in RTL): a red torn scrap, shared by
 * /how-it-works and the 404 page. Server component. Spacing comes from the caller through `className`.
 */
export function CtaLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cn(ctaCls('md'), className)}>
      {children}
      <ArrowLeft className="size-5" aria-hidden />
    </Link>
  );
}
