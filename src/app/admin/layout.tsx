import Link from 'next/link';
import type { Metadata } from 'next';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Ltr } from '@/components/Ltr';
import { admin } from '@/content/ar';
import { verifySession } from '@/lib/auth/session';
import { getSettings } from '@/lib/settings';
import { DAY_MS, shopDayKey } from '@/lib/shop-time';
import { getStorage } from '@/lib/storage';
import { logoutAction } from './actions';
import { designsSummary } from './designs/summary';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: admin.title, robots: { index: false, follow: false } };

/** Customers at today's/yesterday's per-IP limit, for the nav badge. Never breaks the layout. */
async function designAlertCount(): Promise<number> {
  try {
    const storage = getStorage();
    if (!storage.aiUsage) return 0;
    const now = Date.now();
    const settings = await getSettings();
    const usage = await storage.aiUsage(shopDayKey(new Date(now - DAY_MS)));
    return designsSummary(usage, shopDayKey(new Date(now)), settings.ai.perIpDailyLimit).alerts.length;
  } catch {
    return 0;
  }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const authed = await verifySession();
  const alertCount = authed ? await designAlertCount() : 0;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      {authed ? (
        <nav className="mb-6 flex flex-wrap items-center gap-2 border-b pb-3">
          <span className="me-4 text-lg font-bold">{admin.title}</span>
          <Link href="/admin" className={buttonVariants({ variant: 'ghost' })}>
            {admin.nav.orders}
          </Link>
          <Link href="/admin/stats" className={buttonVariants({ variant: 'ghost' })}>
            {admin.nav.stats}
          </Link>
          <Link href="/admin/customers" className={buttonVariants({ variant: 'ghost' })}>
            {admin.nav.customers}
          </Link>
          <Link href="/admin/designs" className={buttonVariants({ variant: 'ghost' })}>
            {admin.nav.designs}
            {alertCount > 0 ? (
              <Badge variant="destructive" className="ms-1">
                <Ltr>{alertCount}</Ltr>
              </Badge>
            ) : null}
          </Link>
          <Link href="/admin/settings" className={buttonVariants({ variant: 'ghost' })}>
            {admin.nav.settings}
          </Link>
          <Link href="/" className={buttonVariants({ variant: 'ghost' })}>
            {admin.nav.site}
          </Link>
          <form action={logoutAction} className="ms-auto">
            <Button type="submit" variant="outline">
              {admin.nav.logout}
            </Button>
          </form>
        </nav>
      ) : null}
      {children}
    </div>
  );
}
