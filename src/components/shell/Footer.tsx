import Link from 'next/link';
import { Phone } from 'lucide-react';
import { common, pages } from '@/content/ar';
import { StickerMark } from '@/components/collage';
import { Ltr } from '@/components/Ltr';
import type { ShopSettings } from '@/lib/types';

const LINK =
  'inline-flex min-h-11 items-center rounded-[2px] underline-offset-4 hover:text-paper hover:underline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-paper';

/**
 * Site footer (Server Component): a navy torn scrap. Brand, hours, contact, links, files notice.
 */
export function Footer({ settings }: { settings: ShopSettings }) {
  const year = new Date().getFullYear();
  return (
    <footer data-site-footer className="scrap scrap-navy mt-16 pt-3 pb-2">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <Link
            href="/"
            className="inline-flex items-center gap-3 rounded-[2px] focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-paper"
          >
            <StickerMark size={44} tilt={-8} />
            <span className="font-lalezar text-2xl font-normal leading-tight">{settings.shopName}</span>
          </Link>
          <p className="mt-3 text-paper/80">{settings.tagline}</p>
          <p className="mt-1 text-paper/65">{settings.area}</p>
        </div>

        <div>
          <h2 className="font-lalezar text-xl font-normal leading-tight text-paper">{common.footer.hours}</h2>
          <p className="mt-3 leading-7 text-paper/80">{settings.hours}</p>
        </div>

        <div>
          <h2 className="font-lalezar text-xl font-normal leading-tight text-paper">{common.footer.contact}</h2>
          <ul className="mt-3 text-paper/80">
            {settings.phone ? (
              <li className="flex items-center gap-2">
                <Phone className="size-4 shrink-0" aria-hidden />
                <a href={`tel:${settings.phone.replace(/[^\d+]/g, '')}`} className={LINK}>
                  <Ltr>{settings.phone}</Ltr>
                </a>
              </li>
            ) : null}
          </ul>
        </div>

        <div>
          <h2 className="font-lalezar text-xl font-normal leading-tight text-paper">{pages.shell.footerLinks}</h2>
          <ul className="mt-3 text-paper/80">
            <li>
              <Link href="/" className={LINK}>
                {common.nav.home}
              </Link>
            </li>
            <li>
              <Link href="/how-it-works" className={LINK}>
                {common.nav.howItWorks}
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t-[3px] border-dashed border-paper/25">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-4 text-center text-xs text-paper/75 sm:flex-row sm:text-start">
          <p>{common.footer.filesNotice}</p>
          <p>
            {settings.shopName} © <Ltr>{year}</Ltr> · {common.footer.rights}
          </p>
        </div>
      </div>
    </footer>
  );
}
