'use client';

import type { ReactNode } from 'react';
import { Check, MessageCircle, Minus, Plus } from 'lucide-react';
import { builder, common } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { Money } from '@/components/Money';
import { fillLtr } from '@/components/fill-ltr';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { whatsappUrl } from '@/lib/parse/phone';
import { formatIqd } from '@/lib/pricing';
import { count } from '@/lib/plural';
import { cn } from '@/lib/utils';
import { activeTier, nextTierNudge, quickPicksFor, sortedTiers } from '../logic';
import type { BuilderApi } from '../useBuilder';

function MaterialPicker({ b }: { b: BuilderApi }) {
  const { pricesPublished } = b.settings;
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{builder.quantity.materialLabel}</legend>
      <div className="grid grid-cols-2 gap-3">
        {b.materials.map((m) => {
          const selected = b.material === m;
          const base = b.settings.pricing.materials[m].pricePerSheetIqd;
          return (
            <label key={m} className="relative block cursor-pointer">
              <input
                type="radio"
                name="material"
                value={m}
                checked={selected}
                onChange={() => b.setMaterial(m)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  'flex min-h-24 flex-col justify-between gap-2 rounded-2xl border-2 bg-card p-4 text-start transition-colors peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50',
                  selected ? 'border-brand bg-brand/5' : 'border-border hover:border-foreground/30',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-lg font-bold">{common.materials[m]}</span>
                  <span
                    aria-hidden
                    className={cn('flex size-6 items-center justify-center rounded-full', selected ? 'bg-brand text-brand-foreground' : 'border')}
                  >
                    {selected && <Check className="size-4" />}
                  </span>
                </span>
                <span className="text-sm text-muted-foreground">
                  {pricesPublished ? (
                    <>
                      <Money amount={base} /> {builder.quantity.perSheetSuffix}
                    </>
                  ) : (
                    builder.quantity.priceUnset
                  )}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function SheetsInput({ b }: { b: BuilderApi }) {
  const { pricing } = b.settings;
  const picks = quickPicksFor(pricing);
  const atMin = b.sheets !== null && b.sheets <= pricing.minSheets;
  const atMax = b.sheets !== null && b.sheets >= pricing.maxSheets;

  const error = b.quantityError ? fillLtr(builder.quantity.errors[b.quantityError], { min: pricing.minSheets, max: pricing.maxSheets }) : null;

  const stepBtn =
    'flex size-12 shrink-0 items-center justify-center rounded-lg border bg-background outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40';

  return (
    <div className="space-y-3">
      <Label htmlFor="sheets-input">{builder.quantity.sheetsLabel}</Label>
      <div className="flex items-center gap-2">
        <button type="button" className={stepBtn} aria-label={builder.quantity.decrease} disabled={atMin} onClick={() => b.stepSheets(-1)}>
          <Minus className="size-5" aria-hidden />
        </button>
        <Input
          id="sheets-input"
          type="text"
          inputMode="numeric"
          dir="ltr"
          autoComplete="off"
          value={b.sheetsText}
          onChange={(e) => b.setSheetsText(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'sheets-error' : 'sheets-hint'}
          className="h-12 flex-1 text-center text-lg font-bold md:text-lg"
        />
        <button type="button" className={stepBtn} aria-label={builder.quantity.increase} disabled={atMax} onClick={() => b.stepSheets(1)}>
          <Plus className="size-5" aria-hidden />
        </button>
      </div>

      {picks.length > 0 && (
        <div role="group" aria-label={builder.quantity.quickPicks} className="flex flex-wrap gap-2">
          {picks.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => b.setSheets(n)}
              aria-pressed={b.sheets === n}
              className={cn(
                'min-h-11 min-w-14 rounded-full border px-4 text-sm font-bold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
                b.sheets === n ? 'border-brand bg-brand text-brand-foreground' : 'bg-background hover:bg-muted',
              )}
            >
              <Ltr>{n}</Ltr>
            </button>
          ))}
        </div>
      )}

      {error ? (
        <p id="sheets-error" role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : (
        <p id="sheets-hint" className="text-sm text-muted-foreground">
          {builder.quantity.minHint} <Ltr>{pricing.minSheets}</Ltr> {count(pricing.minSheets, common.plural.sheet)}
        </p>
      )}
    </div>
  );
}

function DiscountLadder({ b }: { b: BuilderApi }) {
  const tiers = sortedTiers(b.settings.pricing.tiers).filter((t) => t.percent > 0);
  if (tiers.length === 0) return null;
  const reached = activeTier(b.sheets, tiers);
  const nudge = nextTierNudge(b.sheets, tiers);
  return (
    <div className="space-y-2 rounded-2xl border bg-muted/40 p-3">
      <p className="text-sm font-medium">{builder.quantity.discountTitle}</p>
      <ul className="flex flex-wrap gap-2">
        {tiers.map((t) => {
          const on = reached?.minSheets === t.minSheets;
          return (
            <li
              key={t.minSheets}
              aria-current={on ? 'true' : undefined}
              className={cn('rounded-full border px-3 py-1 text-xs font-medium', on
                  ? 'border-discount-foreground/40 bg-discount font-bold text-discount-foreground shadow-sm'
                  : 'border-discount bg-discount/25 text-discount-foreground')}
            >
              <Ltr>{t.minSheets}+</Ltr> {count(t.minSheets, common.plural.sheet)} · {builder.quantity.discountWord} <Ltr>{t.percent}%</Ltr>
            </li>
          );
        })}
      </ul>
      {nudge && (
        <p className="text-sm font-medium text-brand">
          {builder.quantity.nudgeAdd} <Ltr>{nudge.add}</Ltr> {count(nudge.add, common.plural.sheet)} {builder.quantity.nudgeGet} <Ltr>{nudge.percent}%</Ltr>
        </p>
      )}
    </div>
  );
}

function PriceRow({ label, children, strong }: { label: ReactNode; children: ReactNode; strong?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-2', strong ? 'text-base font-bold' : 'text-sm')}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end">{children}</dd>
    </div>
  );
}

function PriceBox({ b }: { b: BuilderApi }) {
  const p = b.price;
  if (!p) return null;
  return (
    <section aria-live="polite" className="rounded-2xl border bg-card p-4">
      <dl className="divide-y">
        <PriceRow label={builder.quantity.unitPrice}>
          {p.unitPriceIqd !== null ? (
            <span className="flex flex-wrap items-baseline justify-end gap-x-2">
              {p.discountPercent > 0 && p.unitBaseIqd !== null && (
                <span className="text-muted-foreground line-through"><Money amount={p.unitBaseIqd} /></span>
              )}
              <span className="font-bold"><Money amount={p.unitPriceIqd} /></span>
              {p.discountPercent > 0 && (
                <span className="rounded-full bg-discount px-2 py-0.5 text-xs font-bold text-discount-foreground">
                  {builder.quantity.discountWord} <Ltr>{p.discountPercent}%</Ltr>
                </span>
              )}
            </span>
          ) : (
            builder.quantity.priceUnset
          )}
        </PriceRow>
        {p.subtotalIqd !== null && p.unitPriceIqd !== null && (
          <PriceRow
            label={
              <>
                {builder.quantity.subtotal} (<Ltr>{p.sheets}</Ltr> × <Ltr>{formatIqd(p.unitPriceIqd)}</Ltr>)
              </>
            }
          >
            <Money amount={p.subtotalIqd} />
          </PriceRow>
        )}
        <PriceRow label={builder.quantity.delivery}><Money amount={p.deliveryFeeIqd} /></PriceRow>
        <PriceRow label={builder.quantity.total} strong>
          {p.totalIqd !== null ? <Money amount={p.totalIqd} /> : builder.quantity.priceUnset}
        </PriceRow>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        <Ltr>{p.totalStickers}</Ltr> {builder.quantity.stickersTotal}
        {p.perStickerIqd !== null && <> · {fillLtr(builder.quantity.perSticker, { price: <Money amount={p.perStickerIqd} /> })}</>}
      </p>
      <p className="text-xs text-muted-foreground">{builder.quantity.deliveryNote}</p>
    </section>
  );
}

export function QuantityStep({ b }: { b: BuilderApi }) {
  const { settings } = b;
  if (b.materials.length === 0) {
    const wa = settings.whatsapp ? whatsappUrl(settings.whatsapp) : null;
    return (
      <div className="space-y-3 rounded-2xl border bg-card p-6 text-center">
        <p className="text-base font-medium">{builder.quantity.noMaterials}</p>
        {wa && (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#25D366] px-5 text-base font-bold text-white outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <MessageCircle className="size-5" aria-hidden />
            {builder.success.whatsapp}
          </a>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <MaterialPicker b={b} />
      <SheetsInput b={b} />
      <DiscountLadder b={b} />
      <PriceBox b={b} />
    </div>
  );
}
