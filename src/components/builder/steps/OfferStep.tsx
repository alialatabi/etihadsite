'use client';

import { Check } from 'lucide-react';
import { builder, common } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { formatIqd } from '@/lib/pricing';
import { count } from '@/lib/plural';
import { cn } from '@/lib/utils';
import { fillNodes } from '../fillNodes';
import { safePrice } from '../safe';
import type { BuilderApi } from '../useBuilder';

function sheetWord(n: number): string {
  try {
    return count(n, common.plural.sheet);
  } catch {
    return builder.offer.sheetsLabel;
  }
}

export function OfferStep({ b }: { b: BuilderApi }) {
  const { layout, settings } = b;
  const fee = formatIqd(settings.deliveryFeeIqd);
  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label={builder.offer.title} className="grid gap-3 sm:grid-cols-3">
        {b.offers.map((o) => {
          const selected = b.offerId === o.id;
          const price = layout ? safePrice(o, layout.countPerSheet, settings) : null;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => b.setOfferId(o.id)}
              className={cn(
                'relative flex min-h-11 flex-col gap-2 rounded-2xl border-2 bg-card p-4 text-start outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
                selected ? 'border-brand bg-brand/5' : 'border-border hover:border-foreground/30',
              )}
            >
              {o.badge && (
                <span className="absolute -top-3 end-3 rounded-full bg-brand px-3 py-0.5 text-xs font-bold text-brand-foreground">{o.badge}</span>
              )}
              <span className="flex items-center justify-between gap-2">
                <span className="text-lg font-bold">
                  <Ltr>{o.sheets}</Ltr> {sheetWord(o.sheets)}
                </span>
                {selected && (
                  <span className="flex size-6 items-center justify-center rounded-full bg-brand text-brand-foreground">
                    <Check className="size-4" aria-hidden />
                  </span>
                )}
              </span>
              {price && (
                <span className="text-sm text-muted-foreground">
                  <Ltr>{price.totalStickers}</Ltr> {builder.offer.stickersTotal}
                </span>
              )}
              <span className="mt-1 text-base font-bold">
                {price?.offerPriceIqd != null ? (
                  <>
                    <Ltr>{formatIqd(price.offerPriceIqd)}</Ltr> {common.units.iqd}
                  </>
                ) : (
                  <span className="text-sm font-medium">{builder.offer.priceUnset}</span>
                )}
              </span>
              {price?.perStickerIqd != null && (
                <span className="text-xs text-muted-foreground">
                  {fillNodes(builder.offer.perSticker, { price: formatIqd(price.perStickerIqd) })}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="text-sm text-muted-foreground">{fillNodes(builder.offer.deliveryNote, { fee })}</p>

      {b.offer && b.price && (
        <p className="rounded-xl bg-muted px-4 py-3 text-sm font-medium">
          {builder.offer.total}:{' '}
          {b.price.totalIqd != null ? (
            <>
              <Ltr>{formatIqd(b.price.totalIqd)}</Ltr> {common.units.iqd}
            </>
          ) : (
            fillNodes(builder.offer.totalUnset, { fee })
          )}
        </p>
      )}
    </div>
  );
}

