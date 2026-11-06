'use client';

import { LoaderCircle, MessageCircle, TriangleAlert } from 'lucide-react';
import { builder, common, fill, governorates } from '@/content/ar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Ltr } from '@/components/Ltr';
import { degradedUrl } from '../degraded';
import { SummaryCard } from '../SummaryCard';
import type { FormFields } from '../logic';
import type { BuilderApi } from '../useBuilder';
import type { SubmitState } from '../useSubmitOrder';

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="text-sm text-destructive">
      {children}
    </p>
  );
}

export function DetailsStep({
  b,
  submit,
  onSubmit,
  onRetry,
}: {
  b: BuilderApi;
  submit: SubmitState;
  onSubmit: () => void;
  onRetry: () => void;
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
          <Label htmlFor="cust-name">
            {builder.details.name} <span className="font-normal text-muted-foreground">{builder.details.nameOptional}</span>
          </Label>
          <Input id="cust-name" autoComplete="name" className="h-12" {...text('name')} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cust-phone">{builder.details.phone}</Label>
          <div dir="ltr" className="flex items-center gap-2">
            <span className="flex h-12 items-center rounded-lg border bg-muted px-3 text-base font-medium tabular-nums" aria-hidden>
              +964
            </span>
            <Input
              id="cust-phone"
              type="tel"
              inputMode="tel"
              dir="ltr"
              autoComplete="tel-national"
              placeholder={builder.details.phonePlaceholder}
              className="h-12 text-lg"
              aria-invalid={e.phone || undefined}
              aria-describedby={e.phone ? 'cust-phone-err' : 'cust-phone-hint'}
              {...text('phone')}
            />
          </div>
          {e.phone ? <FieldError id="cust-phone-err">{builder.details.errors.invalid_phone}</FieldError> : <p id="cust-phone-hint" className="text-xs text-muted-foreground">{builder.details.phoneHint}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="cust-gov">{builder.details.governorate}</Label>
          <Select value={b.fields.governorate || null} onValueChange={(v) => b.setField('governorate', (v as string | null) ?? '')} disabled={busy}>
            <SelectTrigger id="cust-gov" className="h-12 w-full" aria-invalid={e.governorate || undefined} aria-describedby={e.governorate ? 'cust-gov-err' : undefined}>
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
          {e.governorate && <FieldError id="cust-gov-err">{builder.details.errors.governorate}</FieldError>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="cust-district">{builder.details.district}</Label>
          <Input id="cust-district" autoComplete="address-level2" className="h-12" aria-invalid={e.district || undefined} aria-describedby={e.district ? 'cust-district-err' : undefined} {...text('district')} />
          {e.district && <FieldError id="cust-district-err">{builder.details.errors.district}</FieldError>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="cust-landmark">{builder.details.landmark}</Label>
          <Input id="cust-landmark" placeholder={builder.details.landmarkPlaceholder} className="h-12" aria-invalid={e.landmark || undefined} aria-describedby={e.landmark ? 'cust-landmark-err' : undefined} {...text('landmark')} />
          {e.landmark && <FieldError id="cust-landmark-err">{builder.details.errors.landmark}</FieldError>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="cust-notes">
            {builder.details.notes} <span className="font-normal text-muted-foreground">{builder.details.notesOptional}</span>
          </Label>
          <Textarea id="cust-notes" rows={3} {...text('notes')} />
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">{fill(builder.details.consent, { days: b.settings.retentionDays })}</p>

        {busy && (
          <div role="status" className="space-y-2 rounded-xl bg-muted p-4 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              {submit.phase === 'uploading' ? common.status.uploading : common.status.processing}
              {submit.phase === 'uploading' && (
                <Ltr className="ms-auto">{pct}%</Ltr>
              )}
            </p>
            <Progress value={submit.phase === 'uploading' ? pct : 100} />
          </div>
        )}

        {submit.phase === 'failed' && submit.message && (
          <p role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {submit.message}
          </p>
        )}

        {submit.phase === 'degraded' && (
          <div role="alert" className="space-y-3 rounded-2xl border-2 border-brand bg-brand/10 p-4">
            <h4 className="font-heading font-bold">{builder.degraded.title}</h4>
            <p className="text-sm">{builder.degraded.body}</p>
            <div className="flex flex-wrap gap-2">
              {wa && (
                <a
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-12 items-center gap-2 rounded-lg bg-brand px-5 text-base font-bold text-brand-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <MessageCircle className="size-5" aria-hidden />
                  {builder.degraded.whatsapp}
                </a>
              )}
              <Button type="button" variant="outline" className="h-12 px-5" onClick={onRetry}>
                {common.actions.retry}
              </Button>
            </div>
          </div>
        )}

        <Button type="submit" disabled={busy} className="h-12 w-full bg-brand text-base font-bold text-brand-foreground hover:bg-brand/90">
          {builder.details.submit}
        </Button>
      </form>
    </div>
  );
}
