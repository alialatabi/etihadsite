import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { staff } from '@/content/ar';
import { StaffSheets } from '@/components/staff/StaffSheets';
import { getSettings } from '@/lib/settings';
import { STAFF_KEY_HEADER } from '@/lib/staff-gate';
import { isStaffKey } from '@/lib/staff-key';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: staff.title, robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

/**
 * The hidden staff page. Its public link is /staff/<key>; src/proxy.ts rewrites only the right
 * key to this route and passes the key in STAFF_KEY_HEADER. Checking it again here is the
 * second line of defence (a request that reached this route some other way is a 404).
 */
export default async function StaffPage() {
  if (!isStaffKey((await headers()).get(STAFF_KEY_HEADER))) notFound();
  const settings = await getSettings();
  return (
    <section className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{staff.title}</h1>
        <p className="text-sm text-muted-foreground">{staff.intro}</p>
      </div>
      <StaffSheets layoutSettings={settings.layout} quality={settings.quality} />
    </section>
  );
}
