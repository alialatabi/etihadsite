import Link from 'next/link';
import Image from 'next/image';
import { common } from '@/content/ar';
import type { ShopSettings } from '@/lib/types';

/**
 * Site header — placeholder from Phase 0. OWNED BY AGENT E (edit in place; keep the props).
 * Rendered in app/layout.tsx with the current settings.
 */
export function Header({ settings }: { settings: ShopSettings }) {
  return (
    <header className="border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/brand/united-print-logo.jpg" alt={settings.shopName} width={40} height={40} className="rounded-md" />
          <span className="font-heading text-lg font-bold">{settings.shopName}</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/how-it-works" className="hover:text-primary">
            {common.nav.howItWorks}
          </Link>
          <Link href="/#builder" className="rounded-lg bg-brand px-3 py-2 font-medium text-brand-foreground hover:bg-brand/90">
            {common.nav.start}
          </Link>
        </nav>
      </div>
    </header>
  );
}
