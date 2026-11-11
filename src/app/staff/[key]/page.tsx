import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { staff } from '@/content/ar';
import { isStaffKey } from '@/lib/staff-key';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: staff.title, robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function StaffPage({ params }: { params: Promise<{ key: string }> }) {
  if (!isStaffKey((await params).key)) notFound();
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold">{staff.title}</h1>
    </section>
  );
}
