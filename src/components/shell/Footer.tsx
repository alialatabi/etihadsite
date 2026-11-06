import Link from 'next/link';
import Image from 'next/image';
import { MessageCircle, Phone } from 'lucide-react';
import { common, pages } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import type { ShopSettings } from '@/lib/types';
import { whatsappHref } from './whatsapp';

/**
 * Site footer (Server Component). Brand, hours, contact, links, files notice.
 */
export function Footer({ settings }: { settings: ShopSettings }) {
  const wa = whatsappHref(settings.whatsapp);
  const year = new Date().getFullYear();
  return (
    <footer className="mt-16 bg-primary text-primary-foreground">
      <div className="cut-line mx-auto h-px max-w-6xl text-brand/70" aria-hidden />
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <Link href="/" className="inline-flex items-center gap-3">
            <Image src="/icon-192.png" alt="" width={40} height={40} className="size-10 rounded-lg" />
            <span className="font-heading text-lg font-bold">{settings.shopName}</span>
          </Link>
          <p className="mt-3 text-primary-foreground/80">{settings.tagline}</p>
          <p className="mt-1 text-primary-foreground/60">{settings.area}</p>
        </div>

        <div>
          <h2 className="font-heading text-base font-bold">{common.footer.hours}</h2>
          <p className="mt-3 leading-7 text-primary-foreground/80">{settings.hours}</p>
        </div>

        <div>
          <h2 className="font-heading text-base font-bold">{common.footer.contact}</h2>
          <ul className="mt-3 space-y-2 text-primary-foreground/80">
            {settings.phone ? (
              <li className="flex items-center gap-2">
                <Phone className="size-4 shrink-0" aria-hidden />
                <a href={`tel:${settings.phone.replace(/[^\d+]/g, '')}`} className="hover:text-primary-foreground">
                  <Ltr>{settings.phone}</Ltr>
                </a>
              </li>
            ) : null}
            {wa ? (
              <li className="flex items-center gap-2">
                <MessageCircle className="size-4 shrink-0" aria-hidden />
                <a href={wa} target="_blank" rel="noopener noreferrer" className="hover:text-primary-foreground">
                  {common.nav.whatsapp}
                </a>
              </li>
            ) : null}
          </ul>
        </div>

        <div>
          <h2 className="font-heading text-base font-bold">{pages.shell.footerLinks}</h2>
          <ul className="mt-3 space-y-2 text-primary-foreground/80">
            <li>
              <Link href="/" className="hover:text-primary-foreground">
                {common.nav.home}
              </Link>
            </li>
            <li>
              <Link href="/how-it-works" className="hover:text-primary-foreground">
                {common.nav.howItWorks}
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-primary-foreground/15">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-4 text-center text-xs text-primary-foreground/70 sm:flex-row sm:text-start">
          <p>{common.footer.filesNotice}</p>
          <p>
            {settings.shopName} © <Ltr>{year}</Ltr> · {common.footer.rights}
          </p>
        </div>
      </div>
    </footer>
  );
}
