import Link from 'next/link';
import { common, pages } from '@/content/ar';
import { ctaCls, StickerMark } from '@/components/collage';
import type { ShopSettings } from '@/lib/types';
import { NavLink } from './NavLink';

/**
 * Site header (Server Component): a white paper strip with a torn bottom edge, sticky.
 * Only NavLink is a client island. Rendered in app/layout.tsx with the current settings.
 */
export function Header({ settings }: { settings: ShopSettings }) {
  return (
    <header data-site-header className="scrap scrap-white scrap-tornb sticky top-0 z-40 pb-2">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-3 sm:h-16 sm:gap-4 sm:px-4">
        <Link
          href="/"
          aria-label={pages.shell.homeAria}
          className="flex shrink-0 items-center gap-2 rounded-[2px] focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink sm:gap-3"
        >
          <StickerMark size={36} tilt={-6} priority className="size-8 sm:size-9" />
          <span className="font-lalezar text-lg font-normal leading-none text-ink sm:text-xl">{settings.shopName}</span>
        </Link>

        <nav aria-label={pages.shell.menuLabel} className="flex items-center gap-1 text-sm sm:gap-3">
          <NavLink href="/how-it-works" className="whitespace-nowrap">
            {common.nav.howItWorks}
          </NavLink>
          <Link href="/#builder" className={ctaCls('sm')}>
            {common.nav.start}
          </Link>
        </nav>
      </div>
    </header>
  );
}
