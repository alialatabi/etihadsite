import { redirect } from 'next/navigation';
import { admin } from '@/content/ar';
import { verifySession } from '@/lib/auth/session';
import { getSettings } from '@/lib/settings';
import { SettingsForm } from './SettingsForm';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  if (!(await verifySession())) redirect('/admin/login');
  const { saved } = await searchParams;
  const settings = await getSettings();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{admin.settings.title}</h1>
      <SettingsForm settings={settings} saved={saved === '1'} />
    </section>
  );
}
