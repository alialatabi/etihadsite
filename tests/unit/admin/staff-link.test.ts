import { describe, expect, it } from 'vitest';
import { staffLinkFor } from '@/app/admin/settings/staff-link';

const PATH = '/staff/AbCdEfGhIjKlMnOpQrStUvWx1234';
const h = (init: Record<string, string>) => new Headers(init);

describe('staffLinkFor', () => {
  it('uses the forwarded host and proto as they are when they hold one value', () => {
    expect(staffLinkFor(PATH, h({ 'x-forwarded-host': 'softy.iq', 'x-forwarded-proto': 'https', host: 'internal:3000' }))).toBe(
      `https://softy.iq${PATH}`,
    );
  });

  it('takes the first comma-separated value of each forwarded header, trimmed', () => {
    expect(
      staffLinkFor(PATH, h({ 'x-forwarded-host': ' softy.iq , proxy.internal', 'x-forwarded-proto': ' https ,http', host: 'internal' })),
    ).toBe(`https://softy.iq${PATH}`);
    expect(staffLinkFor(PATH, h({ 'x-forwarded-host': 'localhost:3199,other', 'x-forwarded-proto': 'http, https' }))).toBe(
      `http://localhost:3199${PATH}`,
    );
  });

  it('falls back to the host header, and to http only for localhost', () => {
    expect(staffLinkFor(PATH, h({ host: 'softy.iq' }))).toBe(`https://softy.iq${PATH}`);
    expect(staffLinkFor(PATH, h({ host: 'localhost:3000' }))).toBe(`http://localhost:3000${PATH}`);
    expect(staffLinkFor(PATH, h({ host: '127.0.0.1' }))).toBe(`http://127.0.0.1${PATH}`);
    expect(staffLinkFor(PATH, h({ 'x-forwarded-host': ' , ', host: 'softy.iq' }))).toBe(`https://softy.iq${PATH}`);
  });

  it('ignores a forwarded proto that is not http or https', () => {
    expect(staffLinkFor(PATH, h({ host: 'softy.iq', 'x-forwarded-proto': 'javascript' }))).toBe(`https://softy.iq${PATH}`);
    expect(staffLinkFor(PATH, h({ host: 'softy.iq', 'x-forwarded-proto': 'HTTPS' }))).toBe(`https://softy.iq${PATH}`);
  });

  it('no host at all: the bare path', () => {
    expect(staffLinkFor(PATH, h({}))).toBe(PATH);
  });
});
