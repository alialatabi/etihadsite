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
import { PRICE_ROUND_IQD, maxStickers, minStickers } from '@/lib/pricing';
import { count, formatCount } from '@/lib/plural';
import { cn } from '@/lib/utils';
import { activeTier, nextTierNudgeStickers, quickPickStickers, sortedTiers } from '../logic';
import { CountLabel } from '../labels';
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

function StickersInput({ b }: { b: BuilderApi }) {
  const { pricing } = b.settings;
  const cps = b.countPerSheet ?? 0;
  const minS = minStickers(cps, pricing);
  const maxS = maxStickers(cps, pricing);
  const picks = quickPickStickers(pricing, cps);
  const pickTiers = sortedTiers(pricing.tiers);
  const atMin = b.stickers !== null && b.stickers <= minS;
  const atMax = b.stickers !== null && b.stickers >= maxS;

  const error = b.quantityError
    ? fillLtr(builder.quantity.errors[b.quantityError], { min: <CountLabel n={minS} />, max: <CountLabel n={maxS} /> })
    : null;

  const stepBtn =
    'flex size-12 shrink-0 items-center justify-center rounded-lg border bg-background outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40';

  return (
    <div className="space-y-3">
      <Label htmlFor="stickers-input">{builder.quantity.stickersLabel}</Label>
      <div className="flex items-center gap-2">
        <button type="button" className={stepBtn} aria-label={builder.quantity.decrease} disabled={atMin} onClick={() => b.stepSheet(-1)}>
          <Minus className="size-5" aria-hidden />
        </button>
        <Input
          id="stickers-input"
          type="text"
          inputMode="numeric"
          dir="ltr"
          autoComplete="off"
          value={b.stickersText}
          onChange={(e) => b.setStickersText(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'stickers-error' : 'stickers-hint'}
          className="h-12 flex-1 text-center text-lg font-bold md:text-lg"
        />
        <button type="button" className={stepBtn} aria-label={builder.quantity.increase} disabled={atMax} onClick={() => b.stepSheet(1)}>
          <Plus className="size-5" aria-hidden />
        </button>
      </div>

      {picks.length > 0 && (
        <div role="group" aria-label={builder.quantity.quickPicks} className="flex flex-wrap gap-2">
          {picks.map((n) => {
            const percent = activeTier(n / cps, pickTiers)?.percent ?? 0;
            return (
              <button
                key={n}
                type="button"
                onClick={() => b.setStickers(n)}
                aria-pressed={b.stickers === n}
                className={cn(
                  'flex min-h-11 min-w-14 flex-col items-center justify-center gap-0.5 rounded-2xl border px-4 py-1 text-sm font-bold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
                  b.stickers === n ? 'border-brand bg-brand text-brand-foreground' : 'bg-background hover:bg-muted',
                )}
              >
                <Ltr>{formatCount(n)}</Ltr>
                {percent > 0 && (
                  <span className="rounded-full bg-discount px-1.5 text-[11px] font-bold leading-4 text-discount-foreground">
                    {builder.quantity.discountWord} <Ltr>{percent}%</Ltr>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {error ? (
        <p id="stickers-error" role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : (
        <p id="stickers-hint" className="text-sm text-muted-foreground">
          {builder.quantity.minHint} <CountLabel n={minS} /> (<Ltr>{pricing.minSheets}</Ltr> {count(pricing.minSheets, common.plural.sheet)})
        </p>
      )}
    </div>
  );
}

function DiscountLadder({ b }: { b: BuilderApi }) {
  const tiers = sortedTiers(b.settings.pricing.tiers).filter((t) => t.percent > 0);
  if (tiers.length === 0) return null;
  const reached = activeTier(b.sheets, tiers);
  const cps = b.countPerSheet ?? 0;
  const nudge = nextTierNudgeStickers(b.stickers, b.sheets, cps, tiers);
  const currentSheets = b.sheets ?? 0;
  const maxS = maxStickers(cps, b.settings.pricing);
  return (
    <div className="space-y-3 rounded-2xl border bg-muted/40 p-3">
      <p className="text-base font-bold">{builder.quantity.discountTitle}</p>
      <ul className={cn('grid gap-2', tiers.length <= 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4')}>
        {tiers.map((t) => {
          const on = reached?.minSheets === t.minSheets;
          const passed = !on && b.sheets !== null && currentSheets >= t.minSheets;
          return (
            <li
              key={t.minSheets}
              aria-current={on ? 'true' : undefined}
              className={cn(
                'relative flex flex-col items-center gap-0.5 rounded-xl border px-2 py-3 text-center transition-colors',
                on
                  ? 'border-discount-foreground/40 bg-discount text-discount-foreground shadow-sm ring-2 ring-discount-foreground/30'
                  : passed
                    ? 'border-discount bg-discount/25 text-foreground'
                    : 'border-dashed bg-background text-muted-foreground',
              )}
            >
              {on && <Check className="absolute end-1.5 top-1.5 size-4" aria-hidden />}
              <span className="text-2xl font-bold leading-none">
                <Ltr>{t.percent}%</Ltr>
              </span>
              <span className="text-xs font-medium">{builder.quantity.discountWord}</span>
              <span className="mt-1 text-xs font-bold">
                <Ltr>{formatCount(t.minSheets * cps)}+</Ltr> {count(t.minSheets * cps, common.plural.sticker)}
              </span>
              <span className={cn('text-[11px]', on ? 'text-discount-foreground/80' : 'text-muted-foreground')}>
                (<Ltr>{t.minSheets}</Ltr> {count(t.minSheets, common.plural.sheet)})
              </span>
            </li>
          );
        })}
      </ul>
      {nudge && b.stickers !== null && b.stickers + nudge.add <= maxS && (
        <button
          type="button"
          onClick={() => b.setStickers(b.stickers! + nudge.add)}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-discount px-4 py-2 text-sm font-bold text-discount-foreground outline-none transition-colors hover:bg-discount/85 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Plus className="size-4 shrink-0" aria-hidden />
          <span>
            {builder.quantity.nudgeAdd} <Ltr>{formatCount(nudge.add)}</Ltr> {count(nudge.add, common.plural.sticker)} {builder.quantity.nudgeGet} <Ltr>{nudge.percent}%</Ltr>
          </span>
        </button>
      )}
    </div>
  );
}

function ResultBlock({ b }: { b: BuilderApi }) {
  const cps = b.countPerSheet ?? 0;
  const sheets = b.sheets;
  const received = sheets !== null ? sheets * cps : null;
  const discount = sheets !== null ? (b.price?.discountPercent ?? 0) : 0;
  const partial = b.stickers !== null && received !== null && b.stickers !== received;
  const dash = <span className="text-muted-foreground">—</span>;
  return (
    <section id="qty-result" aria-live="polite" className="space-y-2">
      {discount > 0 && (
        <div className="flex justify-center">
          <span className="rounded-full bg-discount px-3 py-1 text-sm font-bold text-discount-foreground shadow-sm">
            {builder.quantity.discountWord} <Ltr>{discount}%</Ltr>
          </span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col items-center gap-1 rounded-2xl border border-brand/30 bg-brand/5 px-2 py-4 text-center">
          <span className="text-sm text-muted-foreground">{builder.quantity.receive}</span>
          <span className="text-3xl font-bold leading-tight text-brand sm:text-4xl">
            {received !== null ? <Ltr>{formatCount(received)}</Ltr> : dash}
          </span>
          <span className="min-h-5 text-sm font-medium">{received !== null ? count(received, common.plural.sticker) : null}</span>
        </div>
        <div className="flex flex-col items-center gap-1 rounded-2xl border border-[#8a2b8f]/30 bg-[#8a2b8f]/5 px-2 py-4 text-center">
          <span className="text-sm text-muted-foreground">{builder.summary.sheets}</span>
          <span className="text-3xl font-bold leading-tight text-[#8a2b8f] sm:text-4xl">
            {sheets !== null ? <Ltr>{sheets}</Ltr> : dash}
          </span>
          <span className="min-h-5 text-sm font-medium">{sheets !== null ? count(sheets, common.plural.sheet) : null}</span>
        </div>
      </div>
      {b.countPerSheet !== null && (
        <p className="text-center text-sm text-muted-foreground">
          <CountLabel n={cps} /> {builder.summary.perSheet}
        </p>
      )}
      {partial && (
        <p className="text-center text-xs text-muted-foreground">
          {builder.summary.requestedStickers} <CountLabel n={b.stickers!} />
        </p>
      )}
    </section>
  );
}

function PriceRow({ label, children, strong }: { label: ReactNode; children: ReactNode; strong?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-2', strong ? 'text-lg font-bold' : 'text-sm')}>
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
                <span className="rounded-full bg-discount px-3 py-1 text-sm font-bold text-discount-foreground">
                  {builder.quantity.discountWord} <Ltr>{p.discountPercent}%</Ltr>
                </span>
              )}
            </span>
          ) : (
            builder.quantity.priceUnset
          )}
        </PriceRow>
        {p.subtotalIqd !== null && (
          <PriceRow
            label={
              <>
                {builder.quantity.subtotal} (<Ltr>{p.sheets}</Ltr> {count(p.sheets, common.plural.sheet)})
              </>
            }
          >
            <Money amount={p.subtotalIqd} />
          </PriceRow>
        )}
        <PriceRow label={builder.quantity.delivery}><Money amount={p.deliveryFeeIqd} /></PriceRow>
        <PriceRow label={builder.quantity.total} strong>
          {p.totalIqd !== null ? <span className="text-xl text-brand"><Money amount={p.totalIqd} /></span> : builder.quantity.priceUnset}
        </PriceRow>
      </dl>
      {p.perStickerIqd !== null && (
        <p className="text-xs text-muted-foreground">{fillLtr(builder.quantity.perSticker, { price: <Money amount={p.perStickerIqd} /> })}</p>
      )}
      {p.roundingIqd != null && p.roundingIqd !== 0 && (
        <p className="text-xs text-muted-foreground">{fillLtr(builder.quantity.roundingNote, { step: <Money amount={PRICE_ROUND_IQD} /> })}</p>
      )}
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
      <StickersInput b={b} />
      <ResultBlock b={b} />
      <DiscountLadder b={b} />
      <PriceBox b={b} />
    </div>
  );
}
