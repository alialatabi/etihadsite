'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Check as CheckIcon, CircleAlert, Plus } from 'lucide-react';
import { Panel, btn, field } from '@/components/admin/kit';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { admin, common } from '@/content/ar';
import { AI_PER_IP_MAX, AI_SITE_MAX, MAX_DISCOUNT_TIERS, MAX_TIER_PERCENT } from '@/lib/storage/settings-limits';
import { MATERIALS, type ShopSettings } from '@/lib/types';
import { umToMm } from '@/lib/units';
import { saveSettingsAction, type SettingsFormState } from '../actions';
import { resolveShapeSpacing } from '@/lib/layout/spacing';
import { RADIUS_FIELD, SHAPE_SPACING_FIELDS } from './fields';

interface TierRow {
  minSheets: string;
  percent: string;
}

const s = admin.settings;

function Field({ name, label, defaultValue, type = 'text', dir, step, min, max }: { step?: string; min?: number; max?: number; name: string; label: string; defaultValue: string; type?: string; dir?: 'ltr' }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name} className={field.label}>{label}</Label>
      <Input id={name} name={name} type={type} className={field.input} defaultValue={defaultValue} dir={dir} step={step ?? (type === 'number' ? 'any' : undefined)} min={min} max={max} />
    </div>
  );
}

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-[15px] font-medium leading-normal text-[#121f34]">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-5 shrink-0 cursor-pointer accent-[#121f34] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d01c4a]" />
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
    <form action={formAction} className="flex flex-col gap-6">
      {saved && !state.error ? (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-[#e7dfdf] bg-[#eef0f4] px-4 py-3 text-[15px] font-semibold text-[#121f34]">
          <CheckIcon aria-hidden className="size-5 shrink-0" />
          {s.saved}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="flex items-center gap-2 rounded-xl border border-[#f3c4cf] bg-[#ffeaed] px-4 py-3 text-[15px] font-semibold text-[#b8163f]">
          <CircleAlert aria-hidden className="size-5 shrink-0" />
          {state.error}
        </p>
      ) : null}

      <Panel title={s.shop} bodyClassName="grid gap-4 md:grid-cols-2">
        <Field name="shopName" label={s.shopName} defaultValue={settings.shopName} />
        <Field name="tagline" label={s.tagline} defaultValue={settings.tagline} />
        <Field name="whatsapp" label={s.whatsapp} defaultValue={settings.whatsapp} dir="ltr" />
        <Field name="phone" label={s.phone} defaultValue={settings.phone} dir="ltr" />
        <Field name="hours" label={s.hours} defaultValue={settings.hours} />
        <Field name="area" label={s.area} defaultValue={settings.area} />
        <Field name="telegramChatId" label={s.telegramChatId} defaultValue={settings.telegramChatId} dir="ltr" />
      </Panel>

      <Panel title={s.pricing} bodyClassName="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <h3 className="text-[16px] font-bold leading-normal text-[#121f34]">{s.materialsTitle}</h3>
          {MATERIALS.map((k) => (
            <div key={k} className="grid items-end gap-3 rounded-xl border border-[#e7dfdf] bg-[#fdfbfa] p-4 md:grid-cols-[1fr_2fr_auto]">
              <div className="text-[16px] font-bold text-[#121f34] md:pb-3">{common.materials[k]}</div>
              <Field name={`${k}Price`} label={s.pricePerSheet} defaultValue={String(pr.materials[k].pricePerSheetIqd)} type="number" dir="ltr" step="1" />
              <div className="md:pb-0.5">
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
          <h3 className="text-[16px] font-bold leading-normal text-[#121f34]">{s.tiersTitle}</h3>
          <p className={field.hint}>{s.tiersHint}</p>
          <input type="hidden" name="tiers" value={tiersJson} />
          {tiers.map((row, i) => (
            <div key={i} className="grid items-end gap-3 rounded-xl border border-[#e7dfdf] bg-[#fdfbfa] p-4 md:grid-cols-[1fr_1fr_auto]">
              <div className="flex flex-col gap-2">
                <Label htmlFor={`tier-from-${i}`} className={field.label}>{s.tierFrom}</Label>
                <Input id={`tier-from-${i}`} className={field.input} type="number" step={1} min={1} dir="ltr" value={row.minSheets} onChange={(e) => patch(i, { minSheets: e.target.value })} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`tier-pct-${i}`} className={field.label}>{s.tierPercent}</Label>
                <Input id={`tier-pct-${i}`} className={field.input} type="number" step={1} min={0} max={MAX_TIER_PERCENT} dir="ltr" value={row.percent} onChange={(e) => patch(i, { percent: e.target.value })} />
              </div>
              <Button type="button" variant="outline" className={btn.outline} onClick={() => setTiers((rows) => rows.filter((_, j) => j !== i))}>
                {s.removeTier}
              </Button>
            </div>
          ))}
          {tiers.length < MAX_DISCOUNT_TIERS ? (
            <div>
              <Button type="button" variant="outline" className={btn.outline} onClick={() => setTiers((rows) => [...rows, { minSheets: '', percent: '' }])}>
                <Plus aria-hidden className="size-5" />
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
      </Panel>

      <Panel title={s.layout} bodyClassName="flex flex-col gap-4">
        <p className={field.hint}>{s.spacingHint}</p>
        {SHAPE_SPACING_FIELDS.map(({ shape, margin, gapX, gapY }) => {
          // Prefill with what is in effect today (fallbacks applied), not with the raw stored keys.
          const now = resolveShapeSpacing(settings.layout, shape);
          return (
            <fieldset key={shape} className="grid gap-3 rounded-xl border border-[#e7dfdf] bg-[#fdfbfa] p-4 md:grid-cols-3">
              <legend className="px-1 text-[16px] font-bold text-[#121f34]">{s.shapeHeading[shape]}</legend>
              <Field name={margin.name} label={s.margin} defaultValue={String(umToMm(now.marginUm))} type="number" dir="ltr" />
              <Field name={gapX.name} label={s.gapX} defaultValue={String(umToMm(now.gapXUm))} type="number" dir="ltr" />
              <Field name={gapY.name} label={s.gapY} defaultValue={String(umToMm(now.gapYUm))} type="number" dir="ltr" />
            </fieldset>
          );
        })}
        <div className="grid gap-4 md:grid-cols-2">
          <Field name={RADIUS_FIELD.name} label={s.roundedRadius} defaultValue={String(umToMm(settings.layout[RADIUS_FIELD.key]))} type="number" dir="ltr" />
          <Field name="retentionDays" label={s.retentionDays} defaultValue={String(settings.retentionDays)} type="number" dir="ltr" />
          <div className="flex items-end">
            <Check name="allowRotate" label={s.allowRotate} defaultChecked={settings.layout.allowRotate} />
          </div>
        </div>
      </Panel>

      <Panel title={s.aiTitle} bodyClassName="flex flex-col gap-4">
        <Check name="aiEnabled" label={s.aiEnabled} defaultChecked={settings.ai.enabled} />
        <div className="grid gap-4 md:grid-cols-2">
          <Field name="aiPerIp" label={s.aiPerIp} defaultValue={String(settings.ai.perIpDailyLimit)} min={1} max={AI_PER_IP_MAX} step="1" type="number" dir="ltr" />
          <Field name="aiSite" label={s.aiSite} defaultValue={String(settings.ai.siteDailyLimit)} min={1} max={AI_SITE_MAX} step="1" type="number" dir="ltr" />
        </div>
      </Panel>

      {/* Sticky on phones so Save is always reachable; inline from sm up. */}
      <div className="sticky bottom-0 z-30 -mx-4 border-t border-[#e7dfdf] bg-[#fdfbfa]/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <Button type="submit" disabled={pending} className={btn.primary}>
          {s.save}
        </Button>
      </div>
    </form>
  );
}
