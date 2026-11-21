/** resendTelegramAction: the orders-list "send to Telegram now" server action. notifyShop is mocked, no network. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import type { OrderRecord } from '@/lib/types';

const revalidated: unknown[][] = [];
let loggedIn = true;
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => void revalidated.push(a) }));
vi.mock('@/lib/auth/guard', () => ({
  requireAdmin: async () => {
    if (!loggedIn) throw new Error('NEXT_REDIRECT /admin/login');
  },
}));

const notifyShop = vi.fn();
vi.mock('@/lib/notify', () => ({ notifyShop: (...a: unknown[]) => notifyShop(...a) }));
vi.mock('@/lib/settings', () => ({ getSettings: async () => DEFAULT_SETTINGS }));

const ORDER_ID = 'order-aaaaaaaaaaaaaaaaaa';
let stored: OrderRecord | null = null;
let pdf: Uint8Array | null = null;
const updateOrder = vi.fn(async (_id: string, patch: { notified?: OrderRecord['notified'] }) => {
  if (stored && patch.notified) stored = { ...stored, notified: patch.notified };
  return stored;
});
vi.mock('@/lib/storage', () => ({
  getStorage: () => ({
    getOrder: async () => stored,
    readFile: async () => pdf,
    updateOrder: (...a: [string, { notified?: OrderRecord['notified'] }]) => updateOrder(...a),
  }),
}));

import { resendTelegramAction } from '@/app/admin/orders/telegram-action';

function record(telegram: OrderRecord['notified']['telegram']): OrderRecord {
  return {
    orderId: ORDER_ID,
    displayNo: 'EP-261201-ABCD',
    createdAt: '2026-11-20T10:00:00.000Z',
    status: 'new',
    spec: { shape: 'circle', widthUm: 30000, heightUm: 30000 },
    price: { material: 'paper', sheets: 20, totalIqd: 70000 },
    customer: { phone: '9647701234567', governorate: 'بغداد', district: 'x', landmark: 'y' },
    files: { designPath: `uploads/${ORDER_ID}.bin`, pdfPath: `orders/${ORDER_ID}.pdf` },
    notified: { telegram },
  } as unknown as OrderRecord;
}

const form = (orderId: string) => {
  const f = new FormData();
  f.set('orderId', orderId);
  return f;
};
const run = (orderId = ORDER_ID) => resendTelegramAction({ status: 'idle' }, form(orderId));

beforeEach(() => {
  vi.clearAllMocks();
  revalidated.length = 0;
  loggedIn = true;
  stored = record('failed');
  pdf = new Uint8Array([1, 2, 3]);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('resendTelegramAction', () => {
  it('refuses when not logged in, before touching anything', async () => {
    loggedIn = false;
    await expect(run()).rejects.toThrow('NEXT_REDIRECT /admin/login');
    expect(notifyShop).not.toHaveBeenCalled();
    expect(updateOrder).not.toHaveBeenCalled();
  });

  it('rejects a bad order id', async () => {
    expect(await run('../etc')).toEqual({ status: 'not_found' });
    expect(await run('')).toEqual({ status: 'not_found' });
    expect(notifyShop).not.toHaveBeenCalled();
  });

  it('answers not_found for an unknown order', async () => {
    stored = null;
    expect(await run()).toEqual({ status: 'not_found' });
    expect(notifyShop).not.toHaveBeenCalled();
  });

  it('does not send again when already sent', async () => {
    stored = record('sent');
    expect(await run()).toEqual({ status: 'sent' });
    expect(notifyShop).not.toHaveBeenCalled();
    expect(updateOrder).not.toHaveBeenCalled();
  });

  it('answers missing_file when the PDF is gone, without notifying', async () => {
    pdf = null;
    expect(await run()).toEqual({ status: 'missing_file' });
    expect(notifyShop).not.toHaveBeenCalled();
    expect(updateOrder).not.toHaveBeenCalled();
  });

  it('stores sent and revalidates when Telegram accepts the file', async () => {
    notifyShop.mockResolvedValue({ telegram: 'sent' });
    expect(await run()).toEqual({ status: 'sent' });
    expect(notifyShop).toHaveBeenCalledTimes(1);
    expect(notifyShop.mock.calls[0]?.[1]).toBe(pdf);
    expect(typeof notifyShop.mock.calls[0]?.[2]).toBe('string');
    expect(updateOrder).toHaveBeenCalledWith(ORDER_ID, { notified: { telegram: 'sent' } });
    expect(revalidated).toEqual([['/admin'], [`/admin/orders/${ORDER_ID}`]]);
  });

  it('failed: state failed, stored skipped becomes failed, no raw error returned', async () => {
    stored = record('skipped');
    notifyShop.mockResolvedValue({ telegram: 'failed', error: 'secret-token-in-url' });
    const out = await run();
    expect(out).toEqual({ status: 'failed' });
    expect(JSON.stringify(out)).not.toContain('secret');
    expect(updateOrder).toHaveBeenCalledWith(ORDER_ID, { notified: { telegram: 'failed' } });
  });

  it('never downgrades a stored sent (another click delivered it meanwhile)', async () => {
    notifyShop.mockImplementation(async () => {
      stored = record('sent');
      return { telegram: 'failed', error: 'x' };
    });
    expect(await run()).toEqual({ status: 'failed' });
    expect(updateOrder).not.toHaveBeenCalled();
  });

  it('skipped (no transport) answers not_configured', async () => {
    notifyShop.mockResolvedValue({ telegram: 'skipped' });
    expect(await run()).toEqual({ status: 'not_configured' });
    expect(updateOrder).toHaveBeenCalledWith(ORDER_ID, { notified: { telegram: 'skipped' } });
  });
});
