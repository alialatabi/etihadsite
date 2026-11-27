import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Panel, btn, field } from '@/components/admin/kit';
import { SectionTitle, StickerMark } from '@/components/collage';
import { PendingSubmit } from '@/components/admin/PendingSubmit';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { common, team } from '@/content/ar';
import { currentStaff } from '@/lib/auth/staff-session';
import { staffLoginAction } from '../actions';

export const dynamic = 'force-dynamic';

// Never indexed, never followed: the staff designer is not part of the public site.
export const metadata: Metadata = { title: team.login.title, robots: { index: false, follow: false } };

function errorText(error: string): string {
  if (error === 'rate') return team.login.rateLimited;
  if (error === 'unavailable') return team.login.unavailable;
  return team.login.error;
}

export default async function TeamLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await currentStaff()) redirect('/team');
  const { error } = await searchParams;
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-6">
      <Panel as="div" className="w-full max-w-sm" bodyClassName="flex flex-col gap-6 !p-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <StickerMark size={56} tilt={-6} alt={common.brand} priority />
          <SectionTitle as="h1" size="sm" tilt={-1.5}>{team.login.title}</SectionTitle>
        </div>
        <form action={staffLoginAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="phone" className={field.label}>{team.login.phone}</Label>
            <Input id="phone" name="phone" type="tel" inputMode="numeric" required autoFocus autoComplete="username" dir="ltr" className={field.input} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password" className={field.label}>{team.login.password}</Label>
            <Input id="password" name="password" type="password" required autoComplete="current-password" dir="ltr" className={field.input} />
          </div>
          {error ? (
            <p role="alert" className={field.error}>
              {errorText(error)}
            </p>
          ) : null}
          <PendingSubmit shadcn className={`${btn.primary} w-full`}>
            {team.login.submit}
          </PendingSubmit>
        </form>
      </Panel>
    </div>
  );
}
