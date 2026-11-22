'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, MessageCircle } from 'lucide-react';
import { builder, common } from '@/content/ar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { whatsappHref } from '@/components/shell/whatsapp';
import type { ShopSettings } from '@/lib/types';
import { MobilePreview, PreviewPanel } from './PreviewPanels';
import { Stepper } from './Stepper';
import { DesignStep } from './steps/DesignStep';
import { DetailsStep } from './steps/DetailsStep';
import { QuantityStep } from './steps/QuantityStep';
import { SizeStep } from './steps/SizeStep';
import { StartStep } from './steps/StartStep';
import { useAiDesign } from './ai/useAiDesign';
import { aiBusy, showViewResult } from './ai/ai-logic';
import { CUSTOMER_FIELD_IDS, STEPS, seedUploadId, toCustomerInfo } from './logic';
import { submitExtras } from './multi-logic';
import { useBuilder } from './useBuilder';
import { useSubmitOrder } from './useSubmitOrder';

const TITLES = {
  shape: builder.ai.title,
  design: builder.upload.title,
  size: builder.size.title,
  quantity: builder.quantity.title,
  details: builder.details.title,
} as const;

/** Height (px) of the bottom screen strip the floating WhatsApp button occupies (h-12 + bottom-4 + air). */
const FLOAT_STRIP_PX = 88;

/** The validated customer fields in form order (the key order of CUSTOMER_FIELD_IDS). */
const CUSTOMER_FIELD_KEYS = Object.keys(CUSTOMER_FIELD_IDS) as (keyof typeof CUSTOMER_FIELD_IDS)[];

/** `aiReady`: the server can design now (switch on, OpenAI key, secret); false shows the notice from the start. */
export function Builder({ settings, aiReady = true }: { settings: ShopSettings; aiReady?: boolean }) {
  const b = useBuilder(settings);
  const ai = useAiDesign(b, aiReady);
  const sub = useSubmitOrder(settings.maxUploadBytes);
  const { consumeRestoredStep } = b;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const navRowRef = useRef<HTMLDivElement>(null);
  // The floating WhatsApp button sits at the start (right) edge, where Back lives, so at every screen
  // width it steps aside while the Back/Next row is inside the bottom strip of the screen, and also at
  // the very end of the page so it never hides the last lines of the footer.
  const [overNav, setOverNav] = useState(false);
  const [atPageEnd, setAtPageEnd] = useState(false);
  const floatHidden = overNav || atPageEnd;

  useEffect(() => {
    const row = navRowRef.current;
    if (!row || typeof IntersectionObserver === 'undefined') return;
    let io: IntersectionObserver | undefined;
    const watch = () => {
      io?.disconnect();
      io = new IntersectionObserver(([e]) => setOverNav(e.isIntersecting), {
        rootMargin: `${-Math.max(0, window.innerHeight - FLOAT_STRIP_PX)}px 0px 0px 0px`,
      });
      io.observe(row);
    };
    const measureEnd = () =>
      setAtPageEnd(window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - FLOAT_STRIP_PX);
    const onResize = () => {
      watch();
      measureEnd();
    };
    watch();
    measureEnd();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', measureEnd, { passive: true });
    return () => {
      io?.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', measureEnd);
    };
  }, []);

  // Move focus to the new step's heading when the step changes (not on first paint).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (consumeRestoredStep()) return; // a reload put the customer back on this step: do not scroll to it
    headingRef.current?.focus({ preventScroll: false });
  }, [b.step, consumeRestoredStep]);

  const handleSubmit = () => {
    b.setShowErrors(true);
    const { errors, phoneE164 } = b.validation;
    const firstBad = CUSTOMER_FIELD_KEYS.find((k) => errors[k]);
    if (firstBad) {
      document.getElementById(CUSTOMER_FIELD_IDS[firstBad])?.focus();
      return;
    }
    if (!b.design || !b.spec || !b.material || b.stickers === null || b.sheets === null || b.quantityError || !b.layoutOk || !phoneE164) return;
    // Several designs: design 1 stays `design` / `spec`, the others go along with their own sizes. A single-design
    // order passes no `extras`, so its input (and request) are exactly what they were.
    const extras = b.multiActive ? submitExtras(b.extras, b.spec.shape) : undefined;
    if (extras === null) return;
    void sub.submit(
      {
        design: b.design,
        spec: b.spec,
        material: b.material,
        stickers: b.stickers,
        sheets: b.sheets,
        customer: toCustomerInfo(b.fields, phoneE164, b.marketingOptIn),
        ...(extras ? { extras } : {}),
      },
      // The accepted AI design is already on the server: reuse its upload while it is still the design.
      seedUploadId({ aiUploadId: b.aiUploadId, aiFileId: b.aiFileId, fileId: b.fileId }),
    );
  };

  const isLast = b.step === STEPS.length - 1;
  // The AI path moves on through its own buttons («ولّد التصميم», «أكمل بهذا»): no generic Next while nothing is
  // accepted, nor while a try runs or a result (kept after a failed retry too) waits for «أكمل بهذا».
  const aiPending =
    b.mode === 'ai' &&
    ((b.stepId === 'shape' && !b.design) || (b.stepId === 'design' && showViewResult(ai.phase, ai.result !== undefined)));
  const title = b.stepId === 'design' && b.mode === 'ai' ? builder.steps.design : TITLES[b.stepId];
  const showStrip = b.stepId === 'size' || b.stepId === 'quantity';
  const inquiry = whatsappHref(settings.whatsapp);

  return (
    <div id="builder">{/* #builder links land below the sticky header: html scroll-padding-top (globals.css) */}
      <div className="mx-auto max-w-6xl px-4 pb-28 pt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-10">
        <div className={cn('min-w-0 space-y-6', b.restoring && 'invisible')} aria-busy={b.restoring || undefined}>
          <Stepper b={b} />

          {showStrip && <MobilePreview b={b} />}

          <div className="rounded-3xl border bg-background p-4 shadow-sm sm:p-6">
            <h2 ref={headingRef} tabIndex={-1} className="font-heading mb-5 text-2xl font-bold outline-none">
              {title}
            </h2>

            {b.stepId === 'shape' && <StartStep b={b} ai={ai} />}
            {b.stepId === 'design' && <DesignStep b={b} ai={ai} />}
            {b.stepId === 'size' && <SizeStep b={b} />}
            {b.stepId === 'quantity' && <QuantityStep b={b} />}
            {b.stepId === 'details' && <DetailsStep b={b} submit={sub.state} onSubmit={handleSubmit} />}

            <div className="cut-line mt-6 h-px text-border" aria-hidden />
            <div ref={navRowRef} className="mt-4 flex items-center justify-between gap-3">
              {/* While a try runs (counted and paid) the page stays on the progress: no Back. */}
              {b.step > 0 && !aiBusy(ai.phase, false) ? (
                <Button type="button" variant="outline" className="h-12 px-5 text-base" onClick={b.back}>
                  <ArrowRight className="size-5" aria-hidden />
                  {common.actions.back}
                </Button>
              ) : (
                <span />
              )}
              {!isLast && !aiPending && (
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
          className={cn(
            'fixed bottom-4 start-4 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-[#25D366] px-4 text-sm font-bold text-[#052e16] shadow-lg ring-2 ring-white/80 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 transition-opacity',
            floatHidden && 'pointer-events-none opacity-0',
          )}
          tabIndex={floatHidden ? -1 : undefined}
          aria-hidden={floatHidden ? true : undefined}
        >
          <MessageCircle className="size-5" aria-hidden />
          {common.nav.inquiry}
        </a>
      )}
    </div>
  );
}
