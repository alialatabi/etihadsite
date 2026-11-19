/**
 * reportError / reportClientError: no-ops without a Sentry client, never throw, accept any thrown
 * value, and send only the ids and codes they are given. Sentry itself is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { scope, sentry, after } = vi.hoisted(() => {
  const scope = { setTag: vi.fn(), setExtras: vi.fn(), setLevel: vi.fn() };
  return {
    scope,
    sentry: {
      getClient: vi.fn(),
      withScope: vi.fn((fn: (s: typeof scope) => void) => fn(scope)),
      captureException: vi.fn(),
      flush: vi.fn(() => Promise.resolve(true)),
    },
    after: vi.fn(),
  };
});
vi.mock('@sentry/nextjs', () => sentry);
vi.mock('next/server', () => ({ after: (fn: () => unknown) => after(fn) }));

import { reportError } from '@/lib/monitoring/report';
import { reportClientError } from '@/lib/monitoring/report.client';

beforeEach(() => {
  vi.clearAllMocks();
  sentry.getClient.mockReturnValue({});
});

describe('reportError (server)', () => {
  it('does nothing while monitoring is off (no client)', () => {
    sentry.getClient.mockReturnValue(undefined);
    reportError(new Error('x'));
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it('captures an Error with tags and extras, and schedules a flush', () => {
    const err = new Error('boom');
    reportError(err, { where: 'orders.post', route: '/api/orders', tags: { orderId: 'abc' }, extra: { n: 1 }, level: 'warning' });
    expect(sentry.captureException).toHaveBeenCalledWith(err, expect.objectContaining({ mechanism: expect.objectContaining({ handled: true }) }));
    expect(scope.setTag).toHaveBeenCalledWith('where', 'orders.post');
    expect(scope.setTag).toHaveBeenCalledWith('route', '/api/orders');
    expect(scope.setTag).toHaveBeenCalledWith('orderId', 'abc');
    expect(scope.setExtras).toHaveBeenCalledWith({ n: 1 });
    expect(scope.setLevel).toHaveBeenCalledWith('warning');
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('wraps a thrown string and an object into an Error', () => {
    reportError('plain text');
    reportError({ code: 5 });
    const [first, second] = sentry.captureException.mock.calls.map((c) => c[0] as Error);
    expect(first).toBeInstanceOf(Error);
    expect(first.message).toBe('plain text');
    expect(second).toBeInstanceOf(Error);
    expect(second.message).toContain('"code":5');
  });

  it('flushes directly when after() is not available (outside a request)', () => {
    after.mockImplementation(() => {
      throw new Error('outside request scope');
    });
    expect(() => reportError(new Error('x'))).not.toThrow();
    expect(sentry.flush).toHaveBeenCalledTimes(1);
  });

  it('never throws, even when Sentry does', () => {
    sentry.withScope.mockImplementationOnce(() => {
      throw new Error('sdk broke');
    });
    expect(() => reportError(new Error('x'))).not.toThrow();
  });
});

describe('reportClientError (browser)', () => {
  it('does nothing without a client, captures with one, never throws', () => {
    sentry.getClient.mockReturnValue(undefined);
    reportClientError(new Error('x'));
    expect(sentry.captureException).not.toHaveBeenCalled();

    sentry.getClient.mockReturnValue({});
    reportClientError('text', { where: 'builder.decode', extra: { fileType: 'image/png' } });
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect((sentry.captureException.mock.calls[0][0] as Error).message).toBe('text');
    expect(scope.setTag).toHaveBeenCalledWith('where', 'builder.decode');

    sentry.withScope.mockImplementationOnce(() => {
      throw new Error('sdk broke');
    });
    expect(() => reportClientError(new Error('y'))).not.toThrow();
  });
});
