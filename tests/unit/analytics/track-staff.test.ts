import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupEnv } from '../server/helpers';

const recordEvent = vi.fn();
vi.mock('@/lib/storage', () => ({
  getStorage: () => ({ recordEvent: (...a: unknown[]) => recordEvent(...a) }),
}));

import { POST } from '@/app/api/track/route';
import { isStaffPath } from '@/lib/analytics/paths';

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
    expect(isStaffPath('/staffing')).toBe(false);
    expect(isStaffPath('/')).toBe(false);
    expect(isStaffPath('/how-it-works')).toBe(false);
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
