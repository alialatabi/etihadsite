import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { staff } from '@/content/ar';
import { SectionTitle } from '@/components/collage';
import { StaffTabs } from '@/components/staff/StaffTabs';
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
      <SectionTitle as="h1" className="block w-fit">
        {staff.title}
      </SectionTitle>
      <StaffTabs layoutSettings={settings.layout} quality={settings.quality} />
    </section>
  );
}
