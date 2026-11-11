import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { staff } from '@/content/ar';
import { StaffSheets } from '@/components/staff/StaffSheets';
import { getSettings } from '@/lib/settings';
import { isStaffKey } from '@/lib/staff-key';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: staff.title, robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function StaffPage({ params }: { params: Promise<{ key: string }> }) {
  if (!isStaffKey((await params).key)) notFound();
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
