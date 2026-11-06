import Link from 'next/link';
import Image from 'next/image';
import { MessageCircle } from 'lucide-react';
import { common, pages } from '@/content/ar';
import type { ShopSettings } from '@/lib/types';
import { NavLink } from './NavLink';
import { whatsappHref } from './whatsapp';

/**
 * Site header (Server Component). Sticky with blur; only NavLink is a client island.
 * Rendered in app/layout.tsx with the current settings.
 */
export function Header({ settings }: { settings: ShopSettings }) {
  const wa = whatsappHref(settings.whatsapp);
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-3 sm:h-16 sm:gap-4 sm:px-4">
        <Link href="/" aria-label={pages.shell.homeAria} className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Image src="/icon-192.png" alt="" width={36} height={36} className="size-8 rounded-lg sm:size-9" priority />
          <span className="font-heading text-base font-bold text-primary sm:text-lg">{settings.shopName}</span>
        </Link>

        <nav aria-label={pages.shell.menuLabel} className="flex items-center gap-1 text-xs sm:gap-3 sm:text-sm">
          <NavLink href="/how-it-works" className="whitespace-nowrap">
            {common.nav.howItWorks}
          </NavLink>
          <Link
            href="/#builder"
            className="whitespace-nowrap rounded-lg bg-brand px-3 py-2 font-bold text-brand-foreground shadow-sm transition-colors hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:px-4"
          >
            {common.nav.start}
          </Link>
          {wa ? (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={pages.shell.whatsappAria}
              className="hidden size-10 items-center justify-center rounded-lg border border-border text-primary transition-colors hover:bg-muted sm:flex"
            >
              <MessageCircle className="size-5" aria-hidden />
            </a>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
