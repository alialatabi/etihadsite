import { admin } from '@/content/ar';
import { requireAdmin } from '@/lib/auth/guard';
import { getSettings } from '@/lib/settings';
import { SettingsForm } from './SettingsForm';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  await requireAdmin();
  const { saved } = await searchParams;
  const settings = await getSettings();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{admin.settings.title}</h1>
      <SettingsForm settings={settings} saved={saved === '1'} />
    </section>
  );
}
