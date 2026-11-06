import { common } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import type { ShopSettings } from '@/lib/types';

/**
 * Site footer — placeholder from Phase 0. OWNED BY AGENT E (edit in place; keep the props).
 */
export function Footer({ settings }: { settings: ShopSettings }) {
  return (
    <footer className="mt-16 border-t border-border/60 bg-muted/40">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-sm md:grid-cols-3">
        <div>
          <p className="font-heading text-base font-bold">{settings.shopName}</p>
          <p className="text-muted-foreground">{settings.tagline}</p>
          <p className="mt-2 text-muted-foreground">{settings.area}</p>
        </div>
        <div>
          <p className="font-medium">{common.footer.hours}</p>
          <p className="text-muted-foreground">{settings.hours}</p>
        </div>
        <div>
          <p className="font-medium">{common.footer.contact}</p>
          {settings.phone ? (
            <p className="text-muted-foreground">
              <Ltr>{settings.phone}</Ltr>
            </p>
          ) : null}
          {settings.whatsapp ? (
            <a href={`https://wa.me/${settings.whatsapp}`} className="text-primary hover:underline">
              {common.nav.whatsapp}
            </a>
          ) : null}
        </div>
      </div>
      <div className="border-t border-border/60 py-4 text-center text-xs text-muted-foreground">
        {common.footer.filesNotice} · {settings.shopName} © <Ltr>{new Date().getFullYear()}</Ltr>
      </div>
    </footer>
  );
}
