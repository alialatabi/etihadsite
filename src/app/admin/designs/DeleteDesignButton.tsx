'use client';

import { useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { btn, field } from '@/components/admin/kit';
import { admin } from '@/content/ar';
import { cn } from '@/lib/utils';
import { deleteDesignAction, type DeleteDesignResult } from './actions';

const d = admin.designs;

/** A design card is narrow (two per row on a phone): the kit button may wrap its text, still at least 44px tall. */
const CARD_BTN = 'h-auto min-h-11 w-full whitespace-normal px-3 py-2 text-center text-[14px] leading-snug';

const MESSAGE: Record<Exclude<DeleteDesignResult['status'], 'deleted' | 'missing'>, string> = {
  refused: d.delete.refused,
  tooNew: d.delete.tooNew,
  invalid: d.delete.invalid,
  error: d.delete.failed,
};

/** «احذف» of an unordered design: asks first (dialog, never window.confirm), then runs the server action. */
export function DeleteDesignButton({ uploadId }: { uploadId: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const confirm = () => {
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await deleteDesignAction(uploadId);
        // deleted / missing: the page refreshes without the card (the action revalidates it).
        if (res.status === 'deleted' || res.status === 'missing') setOpen(false);
        else setMessage(MESSAGE[res.status]);
      } catch {
        setMessage(d.delete.failed);
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) setMessage(null);
      }}
    >
      <DialogTrigger className={cn(btn.danger, CARD_BTN)}>
        <Trash2 aria-hidden className="size-4 shrink-0" />
        {d.card.delete}
      </DialogTrigger>
      <DialogContent dir="rtl" showCloseButton={false} className="rounded-[2px] shadow-paper ring-0">
        <DialogTitle className="text-lg font-bold leading-snug text-ink">{d.delete.title}</DialogTitle>
        <DialogDescription>{d.delete.body}</DialogDescription>
        {message ? (
          <p role="alert" className={cn(field.error, 'font-medium leading-normal')}>
            {message}
          </p>
        ) : null}
        <div className="flex flex-col gap-2">
          <button type="button" onClick={confirm} disabled={pending} className={cn(btn.primary, CARD_BTN)}>
            {pending ? d.delete.deleting : d.delete.confirm}
          </button>
          <DialogClose disabled={pending} className={cn(btn.outline, CARD_BTN)}>
            {d.delete.cancel}
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
