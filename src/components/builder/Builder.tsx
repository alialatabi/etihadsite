'use client';

import { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, MessageCircle } from 'lucide-react';
import { builder, common } from '@/content/ar';
import { Button } from '@/components/ui/button';
import { whatsappUrl } from '@/lib/parse/phone';
import type { ShopSettings } from '@/lib/types';
import { MobilePreview, PreviewPanel } from './PreviewPanels';
import { Stepper } from './Stepper';
import { DesignStep } from './steps/DesignStep';
import { DetailsStep } from './steps/DetailsStep';
import { QuantityStep } from './steps/QuantityStep';
import { ShapeStep } from './steps/ShapeStep';
import { SizeStep } from './steps/SizeStep';
import { CUSTOMER_FIELD_IDS, STEPS, toCustomerInfo } from './logic';
import { useBuilder } from './useBuilder';
import { useSubmitOrder } from './useSubmitOrder';

const TITLES = {
  shape: builder.shape.title,
  design: builder.upload.title,
  size: builder.size.title,
  quantity: builder.quantity.title,
  details: builder.details.title,
} as const;

/** The validated customer fields in form order (the key order of CUSTOMER_FIELD_IDS). */
const CUSTOMER_FIELD_KEYS = Object.keys(CUSTOMER_FIELD_IDS) as (keyof typeof CUSTOMER_FIELD_IDS)[];

export function Builder({ settings }: { settings: ShopSettings }) {
  const b = useBuilder(settings);
  const sub = useSubmitOrder(settings.quality.targetDpi);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // Move focus to the new step's heading when the step changes (not on first paint).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus({ preventScroll: false });
  }, [b.step]);

  const handleSubmit = () => {
    b.setShowErrors(true);
    const { errors, phoneE164 } = b.validation;
    const firstBad = CUSTOMER_FIELD_KEYS.find((k) => errors[k]);
    if (firstBad) {
      document.getElementById(CUSTOMER_FIELD_IDS[firstBad])?.focus();
      return;
    }
    if (!b.design || !b.spec || !b.material || b.stickers === null || b.sheets === null || b.quantityError || !b.layout || !phoneE164) return;
    void sub.submit({
      design: b.design,
      spec: b.spec,
      material: b.material,
      stickers: b.stickers,
      sheets: b.sheets,
      customer: toCustomerInfo(b.fields, phoneE164),
    });
  };

  const isLast = b.step === STEPS.length - 1;
  const showStrip = b.stepId === 'size' || b.stepId === 'quantity';
  const inquiry = settings.whatsapp ? whatsappUrl(settings.whatsapp) : null;

  return (
    <div id="builder" className="scroll-mt-4">
      <div className="mx-auto max-w-6xl px-4 pb-28 pt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-10">
        <div className="min-w-0 space-y-6">
          <Stepper b={b} />

          {showStrip && <MobilePreview b={b} />}

          <div className="rounded-3xl border bg-background p-4 shadow-sm sm:p-6">
            <h2 ref={headingRef} tabIndex={-1} className="font-heading mb-5 text-2xl font-bold outline-none">
              {TITLES[b.stepId]}
            </h2>

            {b.stepId === 'shape' && <ShapeStep b={b} />}
            {b.stepId === 'design' && <DesignStep b={b} />}
            {b.stepId === 'size' && <SizeStep b={b} />}
            {b.stepId === 'quantity' && <QuantityStep b={b} />}
            {b.stepId === 'details' && <DetailsStep b={b} submit={sub.state} onSubmit={handleSubmit} />}

            <div className="cut-line mt-6 h-px text-border" aria-hidden />
            <div className="mt-4 flex items-center justify-between gap-3">
              {b.step > 0 ? (
                <Button type="button" variant="outline" className="h-12 px-5 text-base" onClick={b.back}>
                  <ArrowRight className="size-5" aria-hidden />
                  {common.actions.back}
                </Button>
              ) : (
                <span />
              )}
              {!isLast && (
                <Button
                  type="button"
                  disabled={!b.stepOk[b.stepId]}
                  onClick={b.next}
                  className="h-12 bg-brand px-6 text-base font-bold text-brand-foreground hover:bg-brand/90"
                >
                  {common.actions.next}
                  <ArrowLeft className="size-5" aria-hidden />
                </Button>
              )}
            </div>
          </div>
        </div>

        <PreviewPanel b={b} />
      </div>

      {inquiry && (
        <a
          href={inquiry}
          target="_blank"
          rel="noopener noreferrer"
          className="fixed bottom-4 start-4 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-[#25D366] px-5 text-sm font-bold text-white shadow-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <MessageCircle className="size-5" aria-hidden />
          {common.nav.inquiry}
        </a>
      )}
    </div>
  );
}
