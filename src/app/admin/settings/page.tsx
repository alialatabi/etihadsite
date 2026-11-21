import { ExternalLink } from 'lucide-react';
import { headers } from 'next/headers';
import { AdminPageHeader, Panel } from '@/components/admin/kit';
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
    <section className="flex flex-col">
      <AdminPageHeader title={admin.settings.title} />
      <div className="flex flex-col gap-6">
        {link ? (
          <Panel title={staff.adminLinkLabel}>
            <a
              href={link}
              rel="noreferrer"
              className="flex min-h-11 items-center gap-2 rounded-xl border border-[#e7dfdf] bg-white px-4 py-2 text-[15px] font-medium text-[#121f34] transition-colors hover:bg-[#f7f0ef] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d01c4a]"
            >
              <ExternalLink aria-hidden className="size-5 shrink-0 text-[#5a6475]" />
              <Ltr className="min-w-0 break-all underline underline-offset-4">{link}</Ltr>
            </a>
          </Panel>
        ) : null}
        <SettingsForm settings={settings} saved={saved === '1'} />
      </div>
    </section>
  );
}
