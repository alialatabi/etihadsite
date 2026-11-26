'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CircleCheck, MessageCircle } from 'lucide-react';
import { builder } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { Button } from '@/components/ui/button';
import { MarkerCircle, ScrapHeadline, Tape, btnCls, ctaCls } from '@/components/collage';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { SummaryCard } from '@/components/builder/SummaryCard';
import { loadSuccess, type OrderOk } from '@/components/builder/logic';
import { markOrderNoteSeen, shouldShowOrderNote } from '@/components/builder/order-note';
import { cn } from '@/lib/utils';

export default function OrderSuccessPage() {
  const router = useRouter();
  const [res, setRes] = useState<OrderOk | null>(null);
  // Every order, single or multi-design, gets the "we check every design" popup once on arrival.
  const [noteOpen, setNoteOpen] = useState(false);

  useEffect(() => {
    const stored = loadSuccess();
    if (!stored) {
      router.replace('/');
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is client-only
    setRes(stored);
    setNoteOpen(shouldShowOrderNote(stored.displayNo));
  }, [router]);

  if (!res) return null;
  const waRequired = res.notified.telegram !== 'sent' && Boolean(res.whatsappUrl);

  return (
    <section className="mx-auto max-w-xl space-y-6 px-4 py-10">
      <div className="paper-card relative p-6 text-center">
        <Tape strip="orange" className="absolute -top-3 start-8 -rotate-6" />
        <CircleCheck className="mx-auto size-14 text-brand" aria-hidden />
        <ScrapHeadline as="h1" text={builder.success.title} size="lg" animate className="mt-3" />
        <p className="mt-5 text-sm text-ink-muted">{builder.success.subtitle}</p>
        <p className="mt-3 font-lalezar text-[34px] font-normal leading-tight tracking-wide">
          <MarkerCircle>
            <Ltr>{res.displayNo}</Ltr>
          </MarkerCircle>
        </p>
        <p className="mt-4 text-ink-muted">{builder.success.body}</p>
      </div>

      {waRequired && (
        <p role="alert" className="rounded-[2px] border-2 border-brand bg-brand-tint p-4 text-sm font-medium text-brand-ink">
          {builder.success.whatsappRequired}
        </p>
      )}

      <SummaryCard summary={res.summary} />

      <Dialog
        open={noteOpen}
        onOpenChange={(open) => {
          setNoteOpen(open);
          if (!open) markOrderNoteSeen(res.displayNo);
        }}
      >
        <DialogContent dir="rtl" showCloseButton={false}>
          <DialogTitle className="text-lg font-bold text-ink">{builder.success.title}</DialogTitle>
          <DialogDescription className="text-base leading-relaxed text-ink">{builder.success.checkNote}</DialogDescription>
          <DialogClose render={<Button type="button" className={cn(ctaCls('md'), 'w-full')} />}>
            {builder.success.checkNoteClose}
          </DialogClose>
        </DialogContent>
      </Dialog>

      <div className="flex flex-col gap-3">
        {res.whatsappUrl && (
          <a
            href={res.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'inline-flex items-center justify-center gap-2 rounded-[2px] bg-[#25d366] font-bold text-[#052e16] transition-colors hover:bg-[#20bd5a] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink',
              waRequired ? 'min-h-14 text-lg' : 'min-h-12 text-base',
            )}
          >
            <MessageCircle className="size-5" aria-hidden />
            {builder.success.whatsapp}
          </a>
        )}
        <Link href="/" className={cn(btnCls('outline'), 'min-h-12')}>
          {builder.success.newOrder}
        </Link>
      </div>
    </section>
  );
}
