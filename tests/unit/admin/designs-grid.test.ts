import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { admin } from '@/content/ar';
import type { AiGenerationRecord } from '@/lib/types';

vi.mock('@/app/admin/designs/actions', () => ({ deleteDesignAction: vi.fn() }));

import { DesignGrid, type DesignOrderInfo } from '@/app/admin/designs/DesignGrid';

const NOW = Date.parse('2026-11-26T12:00:00Z');
const row = (id: string, over: Partial<AiGenerationRecord> = {}): AiGenerationRecord => ({
  id: `gen_${id}`,
  createdAt: '2026-11-24T10:00:00Z',
  day: '2026-11-24',
  ip: '1.2.3.4',
  ipKey: 'ab'.repeat(32),
  shape: 'circle',
  corners: 'rounded',
  widthUm: 30_000,
  heightUm: 30_000,
  idea: 'فكرة',
  lines: [],
  hasRefs: false,
  model: 'm',
  uploadId: `upload_${id}12345`,
  orderId: null,
  ...over,
});
const render = (rows: AiGenerationRecord[], orders?: Record<string, DesignOrderInfo>) =>
  renderToStaticMarkup(createElement(DesignGrid, { rows, orders, nowMs: NOW }));

const info: DesignOrderInfo = { displayNo: 'EP-261120-AB3C', customerName: 'علي', phone: '9647701234567', pdfAvailable: true };

describe('DesignGrid cards', () => {
  it('unordered: time left pill, delete button, generated sheet link, no WhatsApp', () => {
    const html = render([row('a')]);
    expect(html).toContain('ينحذف بعد');
    expect(html).toContain(admin.designs.card.delete);
    expect(html).toContain('/api/admin/designs/upload_a12345/sheet');
    expect(html).toContain('/api/admin/designs/upload_a12345/image?download=1');
    expect(html).not.toContain('wa.me');
  });

  it('unordered and in its last day: «ينحذف اليوم»', () => {
    expect(render([row('a', { createdAt: '2026-11-19T18:00:00Z' })])).toContain(admin.designs.expiresToday);
  });

  it('ordered: no delete, no expiry, the order WhatsApp link (new tab, noopener) and the order PDF', () => {
    const html = render([row('b', { orderId: 'order_12345678' })], { order_12345678: info });
    expect(html).not.toContain(admin.designs.card.delete);
    expect(html).not.toContain('ينحذف');
    expect(html).toContain('https://wa.me/9647701234567?text=');
    expect(html).toContain(encodeURIComponent('EP-261120-AB3C'));
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('/api/admin/files/order_12345678/pdf');
    expect(html).not.toContain('/sheet');
  });

  it('ordered but its order did not load, or its PDF was purged: no WhatsApp, the generated sheet instead', () => {
    const noOrder = render([row('b', { orderId: 'order_12345678' })], {});
    expect(noOrder).not.toContain('wa.me');
    expect(noOrder).toContain('/api/admin/designs/upload_b12345/sheet');
    expect(noOrder).not.toContain(admin.designs.card.delete);

    const purged = render([row('b', { orderId: 'order_12345678' })], { order_12345678: { ...info, pdfAvailable: false } });
    expect(purged).toContain('wa.me');
    expect(purged).toContain('/api/admin/designs/upload_b12345/sheet');
    expect(purged).not.toContain('/api/admin/files/');
  });
});
