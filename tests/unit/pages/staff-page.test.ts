/** The hidden staff page: the key decides everything. No JSX here (the glob is *.test.ts). */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class NotFound extends Error {}
const notFound = vi.fn(() => {
  throw new NotFound('NEXT_NOT_FOUND');
});
vi.mock('next/navigation', () => ({ notFound: () => notFound() }));

// The proxy passes the key to the page in a request header (STAFF_KEY_HEADER).
let requestHeaders = new Headers();
vi.mock('next/headers', () => ({ headers: async () => requestHeaders }));

import StaffPage, { generateMetadata } from '@/app/staff-sheets/page';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { staff } from '@/content/ar';
import { STAFF_KEY_HEADER } from '@/lib/staff-gate';

const KEY = 'AbCdEfGhIjKlMnOpQrStUvWx1234';
const saved = process.env.STAFF_PAGE_KEY;
const call = (key: string | null) => {
  requestHeaders = new Headers(key === null ? {} : { [STAFF_KEY_HEADER]: key });
  return StaffPage();
};

beforeEach(() => {
  notFound.mockClear();
  process.env.STAFF_PAGE_KEY = KEY;
});
afterEach(() => {
  if (saved === undefined) delete process.env.STAFF_PAGE_KEY;
  else process.env.STAFF_PAGE_KEY = saved;
});

describe('staff page', () => {
  it('wrong key, different case, short key or no key header: the normal 404', async () => {
    for (const key of ['wrong', KEY.toLowerCase(), KEY.slice(0, 10), '', null]) {
      await expect(call(key)).rejects.toBeInstanceOf(NotFound);
    }
    expect(notFound).toHaveBeenCalledTimes(5);
  });

  it('key not configured: 404 even for a candidate that looks right', async () => {
    delete process.env.STAFF_PAGE_KEY;
    await expect(call(KEY)).rejects.toBeInstanceOf(NotFound);
    process.env.STAFF_PAGE_KEY = KEY.slice(0, 23);
    await expect(call(KEY.slice(0, 23))).rejects.toBeInstanceOf(NotFound);
  });

  it('right key: renders the title and never calls notFound', async () => {
    const html = renderToStaticMarkup(await call(KEY));
    expect(html).toContain(staff.title);
    expect(notFound).not.toHaveBeenCalled();
  });

  it('metadata: noindex, nofollow, no referrer', () => {
    const m = generateMetadata();
    expect(m.title).toBe(staff.title);
    expect(m.robots).toEqual({ index: false, follow: false });
    expect(m.referrer).toBe('no-referrer');
  });
});

describe('the link is never advertised', () => {
  it('robots.ts and sitemap.ts do not mention staff', () => {
    expect(JSON.stringify(robots()).toLowerCase()).not.toContain('staff');
    expect(JSON.stringify(sitemap()).toLowerCase()).not.toContain('staff');
  });
});
