import type { ReactNode } from 'react';
import { MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Shared green WhatsApp call-to-action (home hero, design step, shape step, how-it-works).
 * Callers build `href` with `whatsappLink()` and render nothing when it is null.
 * Colours: WhatsApp green #25D366 with dark-green text (white on #25D366 is only 1.98:1; this is 7.5:1).
 */
const BASE =
  'inline-flex items-center justify-center gap-2 rounded-xl font-bold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50';
const VARIANT = {
  solid: 'bg-[#25D366] text-[#052e16] shadow-sm hover:bg-[#20bd5a]',
  outline: 'border-2 border-[#25D366] bg-card text-[#0b5a2e] hover:bg-[#25D366]/10',
} as const;
const SIZE = {
  md: 'min-h-12 px-5 py-2.5 text-base',
  sm: 'min-h-11 px-4 py-2 text-sm',
} as const;

export function WhatsAppButton({
  href,
  children,
  variant = 'solid',
  size = 'md',
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: keyof typeof VARIANT;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn(BASE, VARIANT[variant], SIZE[size], className)}>
      <MessageCircle className="size-5 shrink-0" aria-hidden />
      {children}
    </a>
  );
}

/** Green-tinted card: title, optional hint, one big WhatsApp button, optional extra content. */
export function WhatsAppCard({
  href,
  title,
  hint,
  cta,
  className,
  children,
}: {
  href: string;
  title: string;
  hint?: string;
  cta: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section className={cn('rounded-2xl border-2 border-[#25D366] bg-[#25D366]/10 p-4 sm:p-5', className)}>
      <h3 className="text-lg font-bold leading-snug">{title}</h3>
      {hint && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{hint}</p>}
      <WhatsAppButton href={href} className="mt-3 w-full sm:w-auto sm:min-w-64">
        {cta}
      </WhatsAppButton>
      {children}
    </section>
  );
}
