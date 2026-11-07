'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { admin } from '@/content/ar';
import type { ShopSettings } from '@/lib/types';
import { saveSettingsAction, type SettingsFormState } from '../actions';

interface OfferRow {
  id: string;
  sheets: string;
  priceIqd: string;
  badge: string;
  enabled: boolean;
}

const toMm = (um: number) => String(um / 1000);
const s = admin.settings;

function Field({ name, label, defaultValue, type = 'text', dir }: { name: string; label: string; defaultValue: string; type?: string; dir?: 'ltr' }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} defaultValue={defaultValue} dir={dir} step={type === 'number' ? 'any' : undefined} />
    </div>
  );
}

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4" />
      {label}
    </label>
  );
}

export function SettingsForm({ settings, saved }: { settings: ShopSettings; saved: boolean }) {
  const [state, formAction, pending] = useActionState<SettingsFormState, FormData>(saveSettingsAction, {});
  const [offers, setOffers] = useState<OfferRow[]>(
    settings.offers.map((o) => ({
      id: o.id,
      sheets: String(o.sheets),
      priceIqd: o.priceIqd === null ? '' : String(o.priceIqd),
      badge: o.badge ?? '',
      enabled: o.enabled,
    })),
  );
  const patch = (i: number, p: Partial<OfferRow>) => setOffers((rows) => rows.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const offersJson = JSON.stringify(
    offers.map((o) => ({ id: o.id, sheets: o.sheets === '' ? NaN : Number(o.sheets), priceIqd: o.priceIqd, badge: o.badge, enabled: o.enabled })),
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {saved && !state.error ? (
        <p role="status" className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          {s.saved}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{s.shop}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field name="shopName" label={s.shopName} defaultValue={settings.shopName} />
          <Field name="tagline" label={s.tagline} defaultValue={settings.tagline} />
          <Field name="whatsapp" label={s.whatsapp} defaultValue={settings.whatsapp} dir="ltr" />
          <Field name="phone" label={s.phone} defaultValue={settings.phone} dir="ltr" />
          <Field name="hours" label={s.hours} defaultValue={settings.hours} />
          <Field name="area" label={s.area} defaultValue={settings.area} />
          <Field name="telegramChatId" label={s.telegramChatId} defaultValue={settings.telegramChatId} dir="ltr" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{s.offers}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <input type="hidden" name="offers" value={offersJson} />
          {offers.map((o, i) => (
            <div key={o.id + i} className="grid items-end gap-3 rounded-lg border p-3 md:grid-cols-[1fr_1.5fr_1fr_auto_auto]">
              <div className="flex flex-col gap-2">
                <Label htmlFor={`sheets-${i}`}>{s.offerSheets}</Label>
                <Input id={`sheets-${i}`} type="number" min={1} dir="ltr" value={o.sheets} onChange={(e) => patch(i, { sheets: e.target.value })} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`price-${i}`}>{s.offerPrice}</Label>
                <Input id={`price-${i}`} type="number" min={0} dir="ltr" value={o.priceIqd} onChange={(e) => patch(i, { priceIqd: e.target.value })} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`badge-${i}`}>{s.offerBadge}</Label>
                <Input id={`badge-${i}`} value={o.badge} maxLength={40} onChange={(e) => patch(i, { badge: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 pb-1.5 text-sm">
                <input type="checkbox" className="size-4" checked={o.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })} />
                {s.offerEnabled}
              </label>
              <Button type="button" variant="outline" onClick={() => setOffers((rows) => rows.filter((_, j) => j !== i))}>
                {s.removeOffer}
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setOffers((rows) => [...rows, { id: `offer-${Date.now().toString(36)}`, sheets: '', priceIqd: '', badge: '', enabled: true }])
              }
            >
              {s.addOffer}
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field name="deliveryFeeIqd" label={s.deliveryFee} defaultValue={String(settings.deliveryFeeIqd)} type="number" dir="ltr" />
            <div className="flex items-end pb-1.5">
              <Check name="pricesPublished" label={s.pricesPublished} defaultChecked={settings.pricesPublished} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{s.layout}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field name="margin" label={s.margin} defaultValue={toMm(settings.layout.marginUm)} type="number" dir="ltr" />
          <Field name="circleGapX" label={s.circleGapX} defaultValue={toMm(settings.layout.circleGapXUm)} type="number" dir="ltr" />
          <Field name="circleGapY" label={s.circleGapY} defaultValue={toMm(settings.layout.circleGapYUm)} type="number" dir="ltr" />
          <Field name="roundedGap" label={s.roundedGap} defaultValue={toMm(settings.layout.rectRoundedGapUm)} type="number" dir="ltr" />
          <Field name="sharpGap" label={s.sharpGap} defaultValue={toMm(settings.layout.rectSharpGapUm)} type="number" dir="ltr" />
          <Field name="customGap" label={s.customGap} defaultValue={toMm(settings.layout.customGapUm)} type="number" dir="ltr" />
          <Field name="roundedRadius" label={s.roundedRadius} defaultValue={toMm(settings.layout.roundedRadiusUm)} type="number" dir="ltr" />
          <Field name="retentionDays" label={s.retentionDays} defaultValue={String(settings.retentionDays)} type="number" dir="ltr" />
          <div className="flex items-end pb-1.5">
            <Check name="allowRotate" label={s.allowRotate} defaultChecked={settings.layout.allowRotate} />
          </div>
        </CardContent>
      </Card>

      <div>
        <Button type="submit" disabled={pending}>
          {s.save}
        </Button>
      </div>
    </form>
  );
}
