'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { admin, common } from '@/content/ar';
import type { ShopSettings } from '@/lib/types';
import { saveSettingsAction, type SettingsFormState } from '../actions';

interface TierRow {
  minSheets: string;
  percent: string;
}

const toMm = (um: number) => String(um / 1000);
const s = admin.settings;

function Field({ name, label, defaultValue, type = 'text', dir, step }: { step?: string; name: string; label: string; defaultValue: string; type?: string; dir?: 'ltr' }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} className="h-12" defaultValue={defaultValue} dir={dir} step={step ?? (type === 'number' ? 'any' : undefined)} />
    </div>
  );
}

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex min-h-12 items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4" />
      {label}
    </label>
  );
}

export function SettingsForm({ settings, saved }: { settings: ShopSettings; saved: boolean }) {
  const [state, formAction, pending] = useActionState<SettingsFormState, FormData>(saveSettingsAction, {});
  const [tiers, setTiers] = useState<TierRow[]>(
    settings.pricing.tiers.map((x) => ({ minSheets: String(x.minSheets), percent: String(x.percent) })),
  );
  const patch = (i: number, p: Partial<TierRow>) => setTiers((rows) => rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const tiersJson = JSON.stringify(tiers);
  const pr = settings.pricing;

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
          <CardTitle>{s.pricing}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <h3 className="font-medium">{s.materialsTitle}</h3>
            {(['paper', 'plastic'] as const).map((k) => (
              <div key={k} className="grid items-end gap-3 rounded-lg border p-3 md:grid-cols-[1fr_2fr_auto]">
                <div className="pb-3 font-medium">{common.materials[k]}</div>
                <Field name={`${k}Price`} label={s.pricePerSheet} defaultValue={String(pr.materials[k].pricePerSheetIqd)} type="number" dir="ltr" step="1" />
                <div className="pb-3">
                  <Check name={`${k}Enabled`} label={s.materialEnabled} defaultChecked={pr.materials[k].enabled} />
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field name="minSheets" label={s.minSheets} defaultValue={String(pr.minSheets)} step="1" type="number" dir="ltr" />
            <Field name="maxSheets" label={s.maxSheets} defaultValue={String(pr.maxSheets)} step="1" type="number" dir="ltr" />
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="font-medium">{s.tiersTitle}</h3>
            <p className="text-sm text-muted-foreground">{s.tiersHint}</p>
            <input type="hidden" name="tiers" value={tiersJson} />
            {tiers.map((row, i) => (
              <div key={i} className="grid items-end gap-3 rounded-lg border p-3 md:grid-cols-[1fr_1fr_auto]">
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`tier-from-${i}`}>{s.tierFrom}</Label>
                  <Input id={`tier-from-${i}`} className="h-12" type="number" step={1} min={1} dir="ltr" value={row.minSheets} onChange={(e) => patch(i, { minSheets: e.target.value })} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`tier-pct-${i}`}>{s.tierPercent}</Label>
                  <Input id={`tier-pct-${i}`} className="h-12" type="number" step={1} min={0} max={90} dir="ltr" value={row.percent} onChange={(e) => patch(i, { percent: e.target.value })} />
                </div>
                <Button type="button" variant="outline" className="h-12" onClick={() => setTiers((rows) => rows.filter((_, j) => j !== i))}>
                  {s.removeTier}
                </Button>
              </div>
            ))}
            {tiers.length < 20 ? (
              <div>
                <Button type="button" variant="secondary" className="h-12" onClick={() => setTiers((rows) => [...rows, { minSheets: '', percent: '' }])}>
                  {s.addTier}
                </Button>
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field name="quickPicks" label={s.quickPicks} defaultValue={pr.quickPicks.join(',')} dir="ltr" />
            <Field name="deliveryFeeIqd" label={s.deliveryFee} defaultValue={String(settings.deliveryFeeIqd)} step="1" type="number" dir="ltr" />
          </div>
          <Check name="pricesPublished" label={s.pricesPublished} defaultChecked={settings.pricesPublished} />
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
        <Button type="submit" disabled={pending} className="h-12">
          {s.save}
        </Button>
      </div>
    </form>
  );
}
