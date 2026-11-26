import type { Metadata } from 'next';
import { TeamDesigner } from '@/components/team/TeamDesigner';
import { remainingFromUsage, type TeamSettings } from '@/components/team/team-logic';
import { Button } from '@/components/ui/button';
import { fill, team } from '@/content/ar';
import { requireStaff } from '@/lib/auth/staff-session';
import { aiReady } from '@/lib/ai/ready';
import { getSettings, toPublicSettings } from '@/lib/settings';
import { shopDayKey } from '@/lib/shop-time';
import { getStorage } from '@/lib/storage';
import type { AiUsageRow } from '@/lib/types';
import { staffLogoutAction } from './actions';

export const dynamic = 'force-dynamic';

// Not for search engines (the proxy also keeps /team out of the sitemap and analytics).
export const metadata: Metadata = { title: team.title, robots: { index: false, follow: false } };

/** The staff designer: a logged-in staff member draws a sticker with the AI and downloads the PNG. */
export default async function TeamPage() {
  const staff = await requireStaff();
  const settings = await getSettings();
  const ready = aiReady(settings);

  // Today's image count of this account: usage rows are keyed 'staff:<id>' under the staff_image kind.
  const storage = getStorage();
  const today = shopDayKey(new Date());
  let rows: AiUsageRow[] | null = null;
  if (storage.aiUsage) {
    try {
      rows = await storage.aiUsage(today, 'staff_image');
    } catch {
      rows = null;
    }
  }
  const remainingToday = remainingFromUsage(rows, staff.id, today);

  // Only what the page needs goes to the browser (the public subset: no chat id, no AI limits).
  const pub = toPublicSettings(settings);
  const teamSettings: TeamSettings = { maxUploadBytes: pub.maxUploadBytes, layout: pub.layout, quality: pub.quality, ai: pub.ai };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{team.title}</h1>
          <p className="text-base">{fill(team.hello, { name: staff.name })}</p>
          <p className="text-sm text-muted-foreground">{team.savedNote}</p>
        </div>
        <form action={staffLogoutAction}>
          <Button type="submit" variant="outline" className="h-11 px-4">
            {team.logout}
          </Button>
        </form>
      </header>
      <TeamDesigner settings={teamSettings} ready={ready} remainingToday={remainingToday} />
    </div>
  );
}
