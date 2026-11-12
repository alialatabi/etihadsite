import { headers } from 'next/headers';
import { Ltr } from '@/components/Ltr';
import { admin, staff } from '@/content/ar';
import { requireAdmin } from '@/lib/auth/guard';
import { getSettings } from '@/lib/settings';
import { staffPagePath } from '@/lib/staff-key';
import { SettingsForm } from './SettingsForm';
import { staffLinkFor } from './staff-link';

export const dynamic = 'force-dynamic';

/** Absolute staff link built from the request host, or null when STAFF_PAGE_KEY is not set. */
async function staffLink(): Promise<string | null> {
  const path = staffPagePath();
  return path === null ? null : staffLinkFor(path, await headers());
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  await requireAdmin();
  const { saved } = await searchParams;
  const settings = await getSettings();
  const link = await staffLink();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{admin.settings.title}</h1>
      {link ? (
        <div className="flex flex-col gap-1 rounded-xl border p-4 text-sm">
          <span className="font-medium">{staff.adminLinkLabel}</span>
          <Ltr>
            <a href={link} className="break-all text-primary underline" rel="noreferrer">
              {link}
            </a>
          </Ltr>
        </div>
      ) : null}
      <SettingsForm settings={settings} saved={saved === '1'} />
    </section>
  );
}
