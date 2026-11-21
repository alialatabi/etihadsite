'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guard';
import { getStorage } from '@/lib/storage';
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
