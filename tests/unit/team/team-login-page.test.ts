/** /team/login: the card keeps a side gutter on a phone (the page has no layout that would add one). */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/staff-session', () => ({ currentStaff: async () => null }));
vi.mock('next/navigation', () => ({
  redirect: (u: string) => {
    throw new Error('NEXT_REDIRECT ' + u);
  },
}));
vi.mock('@/app/team/actions', () => ({ staffLoginAction: async () => {}, staffLogoutAction: async () => {} }));

import TeamLoginPage from '@/app/team/login/page';

describe('TeamLoginPage', () => {
  it('wraps the card in a 16 px side gutter', async () => {
    const html = renderToStaticMarkup(await TeamLoginPage({ searchParams: Promise.resolve({}) }));
    expect(html).toMatch(/<div class="flex min-h-\[60vh\][^"]*\bpx-4\b/);
  });
});
