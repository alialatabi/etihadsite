import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupEnv } from '../server/helpers';

const recordEvent = vi.fn();
vi.mock('@/lib/storage', () => ({
  getStorage: () => ({ recordEvent: (...a: unknown[]) => recordEvent(...a) }),
}));

import { POST } from '@/app/api/track/route';
import { isAdminPath, isStaffPath } from '@/lib/analytics/paths';
import { STAFF_PAGE_ROUTE } from '@/lib/staff-gate';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148';
const req = (body: unknown) =>
  new Request('http://softy.iq/api/track', {
    method: 'POST',
    headers: { 'user-agent': UA, 'x-forwarded-for': '1.2.3.4', host: 'softy.iq' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  setupEnv();
  recordEvent.mockReset().mockResolvedValue(undefined);
});

describe('staff paths are never tracked', () => {
  it('isStaffPath matches /staff and /staff/*, nothing else', () => {
    expect(isStaffPath('/staff')).toBe(true);
    expect(isStaffPath('/staff/abc')).toBe(true);
    expect(isStaffPath(STAFF_PAGE_ROUTE)).toBe(true); // the real route, kept in step with staff-gate.ts
    expect(isStaffPath('/staff-sheets')).toBe(true);
    expect(isStaffPath('/Staff-Sheets/x')).toBe(true);
    expect(isStaffPath('/staffing')).toBe(false);
    expect(isStaffPath('/')).toBe(false);
    expect(isStaffPath('/how-it-works')).toBe(false);
  });

  it('isStaffPath and isAdminPath ignore letter case', () => {
    for (const p of ['/Staff', '/STAFF', '/Staff/abc', '/STAFF/abc', '/sTaFf/abc/def']) expect(isStaffPath(p)).toBe(true);
    for (const p of ['/Staffing', '/STAFFX/abc', '/x/staff']) expect(isStaffPath(p)).toBe(false);
    for (const p of ['/admin', '/admin/orders', '/Admin', '/ADMIN/orders', '/aDmIn/stats']) expect(isAdminPath(p)).toBe(true);
    for (const p of ['/administrator', '/Adminx', '/', '/x/admin']) expect(isAdminPath(p)).toBe(false);
  });

  it('POST /api/track for /Staff/<key> or /Admin/...: 204 and nothing stored, whatever the letter case', async () => {
    for (const body of [
      { type: 'pageview', path: '/Staff/abc' },
      { type: 'pageview', path: '/STAFF/abc', referrer: 'https://example.com/' },
      { type: 'step', step: 'size', path: '/sTaFf' },
      { type: 'install', step: 'shown', path: '/STAFF/abc' },
      { type: 'pageview', path: '/Admin/orders' },
      { type: 'pageview', path: '/ADMIN' },
    ]) {
      expect((await POST(req(body))).status).toBe(204);
    }
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it('POST /api/track for /staff/abc: 204 and nothing stored, for every event type', async () => {
    for (const body of [
      { type: 'pageview', path: '/staff/abc' },
      { type: 'pageview', path: '/staff', referrer: 'https://example.com/' },
      { type: 'step', step: 'size', path: '/staff/abc' },
      { type: 'install', step: 'shown', path: '/staff/abc' },
    ]) {
      expect((await POST(req(body))).status).toBe(204);
    }
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it('a normal path is still stored', async () => {
    expect((await POST(req({ type: 'pageview', path: '/' }))).status).toBe(204);
    expect(recordEvent).toHaveBeenCalledTimes(1);
  });
});
