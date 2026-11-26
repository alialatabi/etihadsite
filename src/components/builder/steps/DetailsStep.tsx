'use client';

import { LoaderCircle, MessageCircle, TriangleAlert } from 'lucide-react';
import { builder, common, governorates } from '@/content/ar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Ltr } from '@/components/Ltr';
import { btnCls, ctaCls, fieldCls } from '@/components/collage';
import { cn } from '@/lib/utils';
import { degradedUrl } from '../degraded';
import { SummaryCard } from '../SummaryCard';
import { CUSTOMER_FIELD_IDS, type FormFields } from '../logic';
import type { BuilderApi } from '../useBuilder';
import type { SubmitState } from '../useSubmitOrder';

/** Ids of the validated inputs; their messages use the same id plus `-err` (phone also `-hint`, `-prefix`). */
const IDS = CUSTOMER_FIELD_IDS;
const errId = (key: keyof typeof IDS) => `${IDS[key]}-err`;

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className={fieldCls.error}>
      {children}
    </p>
  );
}

export function DetailsStep({
  b,
  submit,
  onSubmit,
}: {
  b: BuilderApi;
  submit: SubmitState;
  onSubmit: () => void;
}) {
  const e = b.customerErrors;
  const busy = submit.phase === 'uploading' || submit.phase === 'processing';
  const text = (key: keyof FormFields) => ({
    value: b.fields[key],
    onChange: (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => b.setField(key, ev.target.value),
    disabled: busy,
  });
  const wa = submit.phase === 'degraded' ? degradedUrl(b.settings.whatsapp, b.summary) : null;
  const pct = Math.round(submit.progress * 100);

  return (
    <div className="space-y-5">
      {b.summary && <SummaryCard summary={b.summary} />}

      <form
        noValidate
        className="space-y-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          onSubmit();
        }}
      >

        <div className="space-y-2">
          <Label htmlFor="cust-name" className={fieldCls.label}>
            {builder.details.name} <span className="font-normal text-ink-muted">{builder.details.nameOptional}</span>
          </Label>
          <Input id="cust-name" autoComplete="name" className={cn(fieldCls.input, 'h-12')} {...text('name')} />
        </div>

        <div className="space-y-2">
          <Label htmlFor={IDS.phone} className={fieldCls.label}>{builder.details.phone}</Label>
          <div dir="ltr" className="flex items-center gap-2">
            <span id={`${IDS.phone}-prefix`} className="flex h-12 items-center rounded-[2px] border border-input bg-news px-3 text-base font-medium tabular-nums text-ink">
              +964
            </span>
            <Input
              id={IDS.phone}
              type="tel"
              inputMode="tel"
              dir="ltr"
              autoComplete="tel-national"
              placeholder={builder.details.phonePlaceholder}
              className={cn(fieldCls.input, 'h-12 text-lg md:text-lg')}
              aria-required="true"
              aria-invalid={e.phone || undefined}
              aria-describedby={`${IDS.phone}-prefix ${e.phone ? errId('phone') : `${IDS.phone}-hint`}`}
              {...text('phone')}
            />
          </div>
          {e.phone ? <FieldError id={errId('phone')}>{builder.details.errors.invalid_phone}</FieldError> : <p id={`${IDS.phone}-hint`} className={fieldCls.hint}>{builder.details.phoneHint}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor={IDS.governorate} className={fieldCls.label}>{builder.details.governorate}</Label>
          <Select value={b.fields.governorate || null} onValueChange={(v) => b.setField('governorate', (v as string | null) ?? '')} disabled={busy}>
            <SelectTrigger id={IDS.governorate} className={cn(fieldCls.select, 'data-[size=default]:h-12')} aria-required="true" aria-invalid={e.governorate || undefined} aria-describedby={e.governorate ? errId('governorate') : undefined}>
              <SelectValue placeholder={builder.details.governoratePlaceholder} />
            </SelectTrigger>
            <SelectContent dir="rtl" alignItemWithTrigger={false}>
              {governorates.map((g) => (
                <SelectItem key={g} value={g} className="min-h-11">
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {e.governorate && <FieldError id={errId('governorate')}>{builder.details.errors.governorate}</FieldError>}
        </div>

        <div className="space-y-2">
          <Label htmlFor={IDS.district} className={fieldCls.label}>{builder.details.district}</Label>
          <Input id={IDS.district} autoComplete="address-level2" className={cn(fieldCls.input, 'h-12')} aria-required="true" aria-invalid={e.district || undefined} aria-describedby={e.district ? errId('district') : undefined} {...text('district')} />
          {e.district && <FieldError id={errId('district')}>{builder.details.errors.district}</FieldError>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="cust-landmark" className={fieldCls.label}>
            {builder.details.landmark} <span className="font-normal text-ink-muted">{builder.details.landmarkOptional}</span>
          </Label>
          <Input id="cust-landmark" placeholder={builder.details.landmarkPlaceholder} className={cn(fieldCls.input, 'h-12')} {...text('landmark')} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cust-notes" className={fieldCls.label}>
            {builder.details.notes} <span className="font-normal text-ink-muted">{builder.details.notesOptional}</span>
          </Label>
          <Textarea id="cust-notes" rows={3} className="rounded-[2px] border-input bg-white px-3 text-[16px] md:text-[16px] focus-visible:border-brand focus-visible:ring-brand/30" {...text('notes')} />
        </div>

        <div className="flex items-start gap-3">
          <input
            id="cust-marketing"
            type="checkbox"
            checked={b.marketingOptIn}
            onChange={(ev) => b.setMarketingOptIn(ev.target.checked)}
            disabled={busy}
            className="mt-0.5 size-5 shrink-0 accent-brand"
          />
          <Label htmlFor="cust-marketing" className="font-normal leading-relaxed text-ink">
            {builder.details.marketingOptIn}
          </Label>
        </div>

        <p className={cn(fieldCls.hint, 'leading-relaxed')}>{builder.details.consent}</p>

        {/* Always mounted and empty when idle, so the first message is announced. It names the phase only (no percent
            chatter); the visible block below is not a live region, and the bar takes its name from this text. */}
        <p id="submit-status" role="status" className="sr-only">
          {busy ? (submit.phase === 'uploading' ? common.status.uploading : common.status.processing) : ''}
        </p>

        {busy && (
          <div className="space-y-2 rounded-[2px] bg-news p-4 text-sm text-ink">
            <p className="flex items-center gap-2 font-medium">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              <span aria-hidden="true">{submit.phase === 'uploading' ? common.status.uploading : common.status.processing}</span>
              {submit.phase === 'uploading' && (
                <span className="ms-auto" aria-hidden="true">
                  <Ltr>{pct}%</Ltr>
                </span>
              )}
            </p>
            <Progress value={submit.phase === 'uploading' ? pct : 100} aria-labelledby="submit-status" />
          </div>
        )}

        {submit.phase === 'failed' && submit.message && (
          <p role="alert" className="flex items-start gap-2 rounded-[2px] border border-brand-ink/30 bg-brand-tint p-3 text-sm text-brand-ink">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {submit.message}
          </p>
        )}

        {submit.phase === 'degraded' && (
          <div role="alert" className="space-y-3 rounded-[2px] border border-brand-ink/30 bg-brand-tint p-4 text-ink">
            <h4 className="font-heading font-bold">{builder.degraded.title}</h4>
            <p className="text-sm">{builder.degraded.body}</p>
            <div className="flex flex-wrap gap-2">
              {wa && (
                <a
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={btnCls('ink')}
                >
                  <MessageCircle className="size-5" aria-hidden />
                  {builder.degraded.whatsapp}
                </a>
              )}
              <Button type="button" variant="outline" className={btnCls('outline')} onClick={onSubmit}>
                {common.actions.retry}
              </Button>
            </div>
          </div>
        )}

        <Button type="submit" disabled={busy} className={ctaCls('lg')}>
          {builder.details.submit}
        </Button>
      </form>
    </div>
  );
}
