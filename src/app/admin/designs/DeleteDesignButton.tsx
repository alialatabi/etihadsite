'use client';

import { useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { admin } from '@/content/ar';
import { cardBtn } from './card-styles';
import { deleteDesignAction, type DeleteDesignResult } from './actions';

const d = admin.designs;

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
      <DialogTrigger className={cardBtn.danger}>
        <Trash2 aria-hidden className="size-4 shrink-0" />
        {d.card.delete}
      </DialogTrigger>
      <DialogContent dir="rtl" showCloseButton={false}>
        <DialogTitle>{d.delete.title}</DialogTitle>
        <DialogDescription>{d.delete.body}</DialogDescription>
        {message ? (
          <p role="alert" className="text-[14px] font-medium leading-normal text-[#b8163f]">
            {message}
          </p>
        ) : null}
        <div className="flex flex-col gap-2">
          <button type="button" onClick={confirm} disabled={pending} className={cardBtn.danger}>
            {pending ? d.delete.deleting : d.delete.confirm}
          </button>
          <DialogClose disabled={pending} className={cardBtn.outline}>
            {d.delete.cancel}
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
