import Link from 'next/link';
import type { Metadata } from 'next';
import { Button, buttonVariants } from '@/components/ui/button';
import { admin } from '@/content/ar';
import { verifySession } from '@/lib/auth/session';
import { logoutAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: admin.title, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const authed = await verifySession();
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      {authed ? (
        <nav className="mb-6 flex flex-wrap items-center gap-2 border-b pb-3">
          <span className="me-4 text-lg font-bold">{admin.title}</span>
          <Link href="/admin" className={buttonVariants({ variant: 'ghost' })}>
            {admin.nav.orders}
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
