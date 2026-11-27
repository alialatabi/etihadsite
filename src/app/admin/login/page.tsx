import { redirect } from 'next/navigation';
import { Panel, btn, field } from '@/components/admin/kit';
import { SectionTitle, StickerMark } from '@/components/collage';
import { PendingSubmit } from '@/components/admin/PendingSubmit';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { admin, common } from '@/content/ar';
import { verifySession } from '@/lib/auth/session';
import { loginAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await verifySession()) redirect('/admin');
  const { error } = await searchParams;
  return (
    <div className="flex min-h-[60vh] items-center justify-center py-6">
      <Panel as="div" className="w-full max-w-sm" bodyClassName="flex flex-col gap-6 !p-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <StickerMark size={56} tilt={-6} alt={common.brand} priority />
          <SectionTitle as="h1" size="sm" tilt={-1.5}>{admin.login.title}</SectionTitle>
        </div>
        <form action={loginAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="password" className={field.label}>{admin.login.password}</Label>
            <Input id="password" name="password" type="password" required autoFocus autoComplete="current-password" dir="ltr" className={field.input} />
          </div>
          {error ? (
            <p role="alert" className={field.error}>
              {error === 'rate' ? admin.login.rateLimited : admin.login.error}
            </p>
          ) : null}
          <PendingSubmit shadcn className={`${btn.primary} w-full`}>
            {admin.login.submit}
          </PendingSubmit>
        </form>
      </Panel>
    </div>
  );
}
