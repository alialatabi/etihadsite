'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Ltr } from '@/components/Ltr';
import { admin } from '@/content/ar';

type Item = { href: string; label: string; match: (path: string) => boolean; badge?: number };

const under = (prefix: string) => (path: string) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * Admin top-bar navigation (client island: needs the current path for the active pill).
 * Orders is active on `/admin` and `/admin/orders/*`; every other pill on its own prefix.
 * `designAlerts` is the number shown on the Designs pill (hidden when 0).
 */
export function AdminNav({ designAlerts = 0, className }: { designAlerts?: number; className?: string }) {
  const pathname = usePathname() ?? '';
  const items: Item[] = [
    { href: '/admin', label: admin.nav.orders, match: (p) => p === '/admin' || under('/admin/orders')(p) },
    { href: '/admin/stats', label: admin.nav.stats, match: under('/admin/stats') },
    { href: '/admin/customers', label: admin.nav.customers, match: under('/admin/customers') },
    { href: '/admin/designs', label: admin.nav.designs, match: under('/admin/designs'), badge: designAlerts },
    { href: '/admin/settings', label: admin.nav.settings, match: under('/admin/settings') },
  ];
  return (
    <nav aria-label={admin.title} className={className}>
      <ul className="flex items-center gap-1">
        {items.map((item) => {
          const active = item.match(pathname);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={
                  'inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-xl px-4 text-[15px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fdfbfa] ' +
                  (active ? 'bg-[#fdfbfa] font-bold text-[#121f34]' : 'font-medium text-[#fdfbfa]/85 hover:bg-[#1b2b46]')
                }
              >
                {item.label}
                {item.badge && item.badge > 0 ? (
                  <span className="rounded-full bg-[#ffeaed] px-2 text-[14px] font-bold leading-6 text-[#b8163f]">
                    <Ltr>{item.badge}</Ltr>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
