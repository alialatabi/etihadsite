/** /admin/staff: the owner sets the password for someone else, so he must be able to read it (a plain text field, no password manager). */
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupEnv } from '../server/helpers';

vi.mock('@/lib/auth/guard', () => ({ requireAdmin: async () => {} }));
vi.mock('next/headers', () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/navigation', () => ({
  redirect: (u: string) => {
    throw new Error('NEXT_REDIRECT ' + u);
  },
}));

import StaffAccountsPage from '@/app/admin/staff/page';
import { getStorage } from '@/lib/storage';

beforeEach(() => setupEnv());

describe('StaffAccountsPage password fields', () => {
  it('the create and the reset field are text inputs the browser does not remember', async () => {
    const now = new Date().toISOString();
    await getStorage().staffCreate!({
      id: 'st_abcdefgh12',
      name: 'أحمد',
      phone: '9647701234567',
      active: true,
      createdAt: now,
      passwordChangedAt: now,
      passwordHash: 'scrypt$16384$8$1$AAAA$BBBB',
    });
    const html = renderToStaticMarkup(await StaffAccountsPage({ searchParams: Promise.resolve({}) }));
    const pw = html.match(/<input[^>]*name="password"[^>]*>/g) ?? [];
    expect(pw).toHaveLength(2);
    for (const tag of pw) {
      expect(tag).toContain('type="text"');
      expect(tag).toContain('autoComplete="off"');
      expect(tag).toContain('dir="ltr"');
      expect(tag).not.toContain('type="password"');
      expect(tag).not.toContain('new-password');
    }
  });
});
