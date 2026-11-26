'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
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
 * What deleteDesignAction did. 'refused' = an order uses the design (it is kept); 'missing' = no such row
 * (nothing to do); 'error' = a check or a delete could not run, so NOTHING was removed.
 */
export type DeleteDesignResult = { status: 'deleted' | 'refused' | 'missing' | 'invalid' | 'error' };

/**
 * Deletes a design no order used: its stored image (.bin + .json), then its gallery row. Every check runs
 * BEFORE the first delete, and a check that cannot run (missing adapter method, storage error) refuses:
 * a wrong delete on the live site cannot be undone. A design an order uses is never deleted (the row is
 * healed with that order when only the row was stale).
 */
export async function deleteDesignAction(uploadId: string): Promise<DeleteDesignResult> {
  await requireAdmin();
  const parsed = uploadIdSchema.safeParse(uploadId);
  if (!parsed.success) return { status: 'invalid' };
  const id = parsed.data;

  const storage = getStorage();
  if (!storage.aiGetGeneration || !storage.orderUsingUpload || !storage.aiDeleteGeneration) return { status: 'error' };

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

    await storage.deleteFile(uploadPath(id));
    await storage.deleteFile(uploadMetaPath(id));
    await storage.aiDeleteGeneration(row.id);
  } catch {
    return { status: 'error' };
  }
  revalidatePath('/admin/designs');
  return { status: 'deleted' };
}
