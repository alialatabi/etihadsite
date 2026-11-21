import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { AdminNav } from '@/components/admin/AdminNav';
import { admin } from '@/content/ar';
import { verifySession } from '@/lib/auth/session';
import { getSettings } from '@/lib/settings';
import { DAY_MS, shopDayKey } from '@/lib/shop-time';
import { getStorage } from '@/lib/storage';
import { logoutAction } from './actions';
import { listAiBlocks } from './designs/blocks';
import { alertBadgeCount, designsSummary } from './designs/summary';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: admin.title, robots: { index: false, follow: false } };

/**
 * Customers (distinct IP keys) at today's/yesterday's per-IP limit and not yet blocked, for the nav badge.
 * Never breaks the layout.
 */
async function designAlertCount(): Promise<number> {
  try {
    const storage = getStorage();
    if (!storage.aiUsage) return 0;
    const now = Date.now();
    const [settings, usage, blocks] = await Promise.all([
      getSettings(),
      storage.aiUsage(shopDayKey(new Date(now - DAY_MS)), 'image'),
      listAiBlocks(),
    ]);
    const blockedKeys = new Set(blocks.map((b) => b.ipKey));
    return alertBadgeCount(designsSummary(usage, shopDayKey(new Date(now)), settings.ai.perIpDailyLimit, blockedKeys).alerts);
  } catch {
    return 0;
  }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const authed = await verifySession();
  const alertCount = authed ? await designAlertCount() : 0;
  return (
    <>
      {authed ? (
        <div className="sticky top-0 z-40 w-full bg-[#121f34] text-[#fdfbfa]">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:px-6 md:flex-nowrap">
            <div className="order-1 flex min-w-0 items-center gap-3">
              <Image src="/brand/softy-mark.png" alt="" width={36} height={36} className="size-9 shrink-0 rounded-lg" priority />
              <span className="truncate text-[18px] font-bold">{admin.title}</span>
            </div>
            <div className="order-2 ms-auto flex shrink-0 items-center gap-1 md:order-3">
              <Link
                href="/"
                className="inline-flex h-11 items-center rounded-xl px-3 text-[15px] font-medium text-[#fdfbfa]/85 transition-colors hover:bg-[#1b2b46] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fdfbfa]"
              >
                {admin.nav.site}
              </Link>
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="inline-flex h-11 items-center rounded-xl border border-[#2a3a55] px-4 text-[15px] font-medium text-[#fdfbfa] transition-colors hover:bg-[#1b2b46] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fdfbfa]"
                >
                  {admin.nav.logout}
                </button>
              </form>
            </div>
            <AdminNav
              designAlerts={alertCount}
              className="order-3 -mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 sm:-mx-6 sm:w-[calc(100%+3rem)] sm:px-6 md:order-2 md:mx-0 md:w-auto md:min-w-0 md:flex-1 md:overflow-visible md:px-0"
            />
          </div>
        </div>
      ) : null}
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">{children}</div>
    </>
  );
}
