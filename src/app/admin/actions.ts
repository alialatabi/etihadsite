'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { admin } from '@/content/ar';
import { checkPassword, createSession, destroySession, verifySession } from '@/lib/auth/session';
import { clientIp, limiters } from '@/lib/rate-limit';
import { getStorage } from '@/lib/storage';
import { ID_RE } from '@/lib/storage/paths';
import { shopSettingsSchema } from '@/lib/storage/settings-schema';
import type { OrderStatus, ShopSettings } from '@/lib/types';

export async function loginAction(formData: FormData): Promise<void> {
  const h = await headers();
  const ip = clientIp(new Request('http://local', { headers: { 'x-forwarded-for': h.get('x-forwarded-for') ?? '' } }));
  if (!limiters().login.check(ip).ok) redirect('/admin/login?error=rate');
  const password = formData.get('password');
  if (typeof password !== 'string' || !checkPassword(password)) redirect('/admin/login?error=1');
  await createSession();
  redirect('/admin');
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect('/admin/login');
}

const STATUSES: OrderStatus[] = ['new', 'printing', 'done', 'cancelled'];

export async function updateOrderStatus(formData: FormData): Promise<void> {
  if (!(await verifySession())) redirect('/admin/login');
  const orderId = String(formData.get('orderId') ?? '');
  const status = String(formData.get('status') ?? '') as OrderStatus;
  if (!ID_RE.test(orderId) || !STATUSES.includes(status)) redirect('/admin');
  await getStorage().updateOrder(orderId, { status });
  revalidatePath('/admin');
  redirect(`/admin/orders/${orderId}?updated=1`);
}

export interface SettingsFormState {
  error?: string;
}

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const intOf = (f: FormData, k: string) => {
  const v = str(f, k);
  return v === '' ? NaN : Number(v);
};
const mmToUm = (f: FormData, k: string) => {
  const mm = intOf(f, k);
  return Number.isFinite(mm) ? Math.round(mm * 1000) : NaN;
};

const s = admin.settings;

export async function saveSettingsAction(_prev: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  if (!(await verifySession())) redirect('/admin/login');
  const storage = getStorage();
  const current = await storage.getSettings();

  let tiersRaw: unknown;
  try {
    tiersRaw = JSON.parse(str(formData, 'tiers') || '[]');
  } catch {
    tiersRaw = null;
  }
  if (!Array.isArray(tiersRaw)) return { error: s.invalid };
  const tiers = tiersRaw.map((r: Record<string, unknown>) => ({
    minSheets: r?.minSheets === '' ? NaN : Number(r?.minSheets),
    percent: r?.percent === '' ? NaN : Number(r?.percent),
  }));
  const quickPicks = str(formData, 'quickPicks')
    .split(/[,،\s]+/)
    .filter(Boolean)
    .map(Number);

  const pricing: ShopSettings['pricing'] = {
    materials: {
      paper: { enabled: formData.get('paperEnabled') === 'on', pricePerSheetIqd: intOf(formData, 'paperPrice') },
      plastic: { enabled: formData.get('plasticEnabled') === 'on', pricePerSheetIqd: intOf(formData, 'plasticPrice') },
    },
    minSheets: intOf(formData, 'minSheets'),
    maxSheets: intOf(formData, 'maxSheets'),
    tiers,
    quickPicks,
  };

  const m = pricing.materials;
  if (!m.paper.enabled && !m.plastic.enabled) return { error: s.errors.noMaterial };
  if (pricing.minSheets > pricing.maxSheets) return { error: s.errors.minMax };
  if (tiers.length > 20) return { error: s.errors.tiersMax };
  if (new Set(tiers.map((x) => x.minSheets)).size !== tiers.length) return { error: s.errors.duplicateTier };
  if (tiers.some((x) => Number.isInteger(x.percent) && (x.percent < 0 || x.percent > 90))) return { error: s.errors.tierPercent };
  if (quickPicks.length > 8 || quickPicks.some((n) => !Number.isInteger(n) || n < 1)) return { error: s.errors.quickPicks };
  if (quickPicks.some((n) => n < pricing.minSheets || n > pricing.maxSheets)) return { error: s.errors.quickPicksRange };
  const nums = [m.paper.pricePerSheetIqd, m.plastic.pricePerSheetIqd, pricing.minSheets, pricing.maxSheets, ...tiers.flatMap((x) => [x.minSheets, x.percent])];
  if (nums.some((n) => !Number.isInteger(n))) return { error: s.errors.number };

  const candidate: ShopSettings = {
    ...current,
    shopName: str(formData, 'shopName'),
    tagline: str(formData, 'tagline'),
    whatsapp: str(formData, 'whatsapp').replace(/\D/g, ''),
    phone: str(formData, 'phone'),
    hours: str(formData, 'hours'),
    area: str(formData, 'area'),
    telegramChatId: str(formData, 'telegramChatId'),
    pricing,
    deliveryFeeIqd: intOf(formData, 'deliveryFeeIqd'),
    pricesPublished: formData.get('pricesPublished') === 'on',
    retentionDays: intOf(formData, 'retentionDays'),
    layout: {
      ...current.layout,
      marginUm: mmToUm(formData, 'margin'),
      circleGapXUm: mmToUm(formData, 'circleGapX'),
      circleGapYUm: mmToUm(formData, 'circleGapY'),
      rectRoundedGapUm: mmToUm(formData, 'roundedGap'),
      rectSharpGapUm: mmToUm(formData, 'sharpGap'),
      customGapUm: mmToUm(formData, 'customGap'),
      roundedRadiusUm: mmToUm(formData, 'roundedRadius'),
      allowRotate: formData.get('allowRotate') === 'on',
    },
  };

  const parsed = shopSettingsSchema.safeParse(candidate);
  if (!parsed.success) {
    return { error: admin.settings.invalid };
  }
  await storage.saveSettings(parsed.data as ShopSettings);
  revalidatePath('/', 'layout');
  redirect('/admin/settings?saved=1');
}
