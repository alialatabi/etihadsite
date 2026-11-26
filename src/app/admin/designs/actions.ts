'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { DESIGN_DELETE_MIN_AGE_MS } from '@/config/defaults';
import { requireAdmin } from '@/lib/auth/guard';
import { getStorage } from '@/lib/storage';
import { ID_RE, uploadMetaPath, uploadPath } from '@/lib/storage/paths';
import { IP_KEY_RE } from './summary';

/** 64 hex = the keyed hash of an IP. '' (a site-only usage row) is rejected on purpose. */
const blockSchema = z.object({ ipKey: z.string().regex(IP_KEY_RE), ip: z.string().max(64) });
const unblockSchema = z.object({ ipKey: z.string().regex(IP_KEY_RE) });

export async function blockIpAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = blockSchema.safeParse({ ipKey: formData.get('ipKey'), ip: formData.get('ip') ?? '' });
  if (!parsed.success) return;
  await getStorage().aiBlock?.(parsed.data.ipKey, parsed.data.ip);
  revalidatePath('/admin/designs');
}

export async function unblockIpAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = unblockSchema.safeParse({ ipKey: formData.get('ipKey') });
  if (!parsed.success) return;
  await getStorage().aiUnblock?.(parsed.data.ipKey);
  revalidatePath('/admin/designs');
}

const uploadIdSchema = z.string().regex(ID_RE);

/**
 * What deleteDesignAction did. 'refused' = an order uses the design (it is kept); 'tooNew' = the design is
 * younger than DESIGN_DELETE_MIN_AGE_MS (a customer may be ordering it right now); 'missing' = no such row
 * (nothing to do); 'error' = a check could not run or the row could not be deleted, so NOTHING was removed;
 * 'deleted' = the gallery row is gone (`filesLeft`: its image files could not be removed and stay behind as
 * orphans, which the daily purge of unused uploads sweeps after UNORDERED_DESIGN_DAYS).
 */
export type DeleteDesignResult = {
  status: 'deleted' | 'refused' | 'tooNew' | 'missing' | 'invalid' | 'error';
  filesLeft?: true;
};

/**
 * Deletes a design no order used: its gallery row first, then its stored image (.bin + .json). Every check
 * runs BEFORE the first delete, and a check that cannot run (missing adapter method, storage error) refuses:
 * a wrong delete on the live site cannot be undone. A design an order uses is never deleted (the row is
 * healed with that order when only the row was stale), and neither is one made less than
 * DESIGN_DELETE_MIN_AGE_MS ago. The row goes first so a failure never leaves a card whose image is gone; if
 * the files then fail to delete the design is still reported 'deleted' (with `filesLeft`).
 */
export async function deleteDesignAction(uploadId: string): Promise<DeleteDesignResult> {
  await requireAdmin();
  const parsed = uploadIdSchema.safeParse(uploadId);
  if (!parsed.success) return { status: 'invalid' };
  const id = parsed.data;

  const storage = getStorage();
  if (!storage.aiGetGeneration || !storage.orderUsingUpload || !storage.aiDeleteGeneration) return { status: 'error' };

  let filesLeft = false;
  try {
    const row = await storage.aiGetGeneration(id);
    if (!row) return { status: 'missing' };
    if (row.orderId) return { status: 'refused' };

    const usedBy = await storage.orderUsingUpload(id);
    if (usedBy) {
      // The row was never marked (an old or failed mark): heal it so the page shows the truth.
      await storage.aiMarkOrdered?.(id, usedBy).catch(() => undefined);
      revalidatePath('/admin/designs');
      return { status: 'refused' };
    }

    // A draft in the builder lives 2 hours: a design younger than that may be in a customer's order right now.
    // An unreadable date cannot prove the design is old enough, so it refuses as well.
    if (!(Date.now() - Date.parse(row.createdAt) >= DESIGN_DELETE_MIN_AGE_MS)) return { status: 'tooNew' };

    await storage.aiDeleteGeneration(row.id);
    try {
      await storage.deleteFile(uploadPath(id));
      await storage.deleteFile(uploadMetaPath(id));
    } catch {
      filesLeft = true;
    }
  } catch {
    return { status: 'error' };
  }
  revalidatePath('/admin/designs');
  return filesLeft ? { status: 'deleted', filesLeft: true } : { status: 'deleted' };
}
