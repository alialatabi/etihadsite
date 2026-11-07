'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CircleCheck, MessageCircle } from 'lucide-react';
import { builder } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { buttonVariants } from '@/components/ui/button';
import { SummaryCard } from '@/components/builder/SummaryCard';
import { loadSuccess } from '@/components/builder/logic';
import { cn } from '@/lib/utils';
import type { OrderResponse } from '@/lib/types';

type Ok = Extract<OrderResponse, { ok: true }>;

export default function OrderSuccessPage() {
  const router = useRouter();
  const [res, setRes] = useState<Ok | null>(null);

  useEffect(() => {
    const stored = loadSuccess();
    if (!stored) {
      router.replace('/');
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is client-only
    setRes(stored);
  }, [router]);

  if (!res) return null;
  const hasWa = Boolean(res.whatsappUrl);
  const waRequired = res.notified.telegram !== 'sent' && hasWa;
  const { displayNo: _no, ...summary } = res.summary;
  void _no;

  return (
    <section className="mx-auto max-w-xl space-y-6 px-4 py-10">
      <div className="text-center">
        <CircleCheck className="mx-auto size-14 text-brand" aria-hidden />
        <h1 className="font-heading mt-3 text-3xl font-bold">{builder.success.title}</h1>
        <p className="mt-4 text-sm text-muted-foreground">{builder.success.subtitle}</p>
        <p className="mt-1 text-3xl font-bold tracking-wide">
          <Ltr>{res.displayNo}</Ltr>
        </p>
        <p className="mt-4 text-muted-foreground">{builder.success.body}</p>
      </div>

      {waRequired && (
        <p role="alert" className="rounded-xl border-2 border-brand bg-brand/10 p-4 text-sm font-medium">
          {builder.success.whatsappRequired}
        </p>
      )}

      <SummaryCard summary={summary} />

      <div className="flex flex-col gap-3">
        {res.whatsappUrl && (
          <a
            href={res.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'inline-flex items-center justify-center gap-2 rounded-lg font-bold outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              waRequired ? 'h-14 bg-brand text-lg text-brand-foreground' : 'h-12 border border-border bg-background text-base',
            )}
          >
            <MessageCircle className="size-5" aria-hidden />
            {builder.success.whatsapp}
          </a>
        )}
        <Link href="/" className={cn(buttonVariants({ variant: 'outline' }), 'h-12 text-base')}>
          {builder.success.newOrder}
        </Link>
      </div>
    </section>
  );
}
