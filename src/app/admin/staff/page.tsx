import { Users } from 'lucide-react';
import { headers } from 'next/headers';
import Link from 'next/link';
import { Ltr } from '@/components/Ltr';
import { fillLtr } from '@/components/fill-ltr';
import { AdminPageHeader, EmptyState, InfoStrip, Panel, Pill, btn, field } from '@/components/admin/kit';
import { PendingSubmit } from '@/components/admin/PendingSubmit';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { admin } from '@/content/ar';
import { STAFF_IMAGE_DAILY_LIMIT } from '@/lib/ai/config';
import { requireAdmin } from '@/lib/auth/guard';
import { STAFF_PASSWORD_MIN } from '@/lib/auth/password';
import { toStaffAccount } from '@/lib/auth/staff-session';
import { formatPhoneLocal } from '@/lib/parse/phone';
import { shopDayKey } from '@/lib/shop-time';
import { getStorage } from '@/lib/storage';
import { isStaffNotReady } from '@/lib/storage/staff-errors';
import type { AiUsageRow, StaffAccount } from '@/lib/types';
import { createStaffAction, resetStaffPasswordAction, setStaffActiveAction } from './actions';

export const dynamic = 'force-dynamic';

const s = admin.staff;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** The only `?error=` values the actions send; anything else is ignored. */
const ERROR_KEYS = ['phoneTaken', 'invalid', 'notReady'] as const;

export default async function StaffAccountsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const errorParam = first(sp.error);
  const errorKey = ERROR_KEYS.find((k) => k === errorParam);
  const saved = first(sp.saved) === '1';

  const storage = getStorage();
  let notReady = !storage.staffList;
  let accounts: StaffAccount[] = [];
  if (storage.staffList) {
    try {
      // The password hash is stripped here, before anything reaches the JSX.
      accounts = (await storage.staffList()).map(toStaffAccount);
    } catch (e) {
      if (!isStaffNotReady(e)) throw e;
      notReady = true;
    }
  }

  // Today's image count per account: usage rows are keyed 'staff:<id>' under the staff_image kind.
  const today = shopDayKey(new Date());
  let usage: AiUsageRow[] = [];
  if (!notReady) {
    try {
      usage = (await storage.aiUsage?.(today, 'staff_image')) ?? [];
    } catch {
      usage = [];
    }
  }
  const used = new Map<string, number>();
  for (const r of usage) if (r.day === today) used.set(r.ipKey, r.count);

  const h = await headers();
  const host = h.get('host');
  const loginUrl = host ? `${h.get('x-forwarded-proto') ?? 'http'}://${host}/team/login` : '/team/login';

  return (
    <section className="flex flex-col gap-6">
      <AdminPageHeader className="!mb-0" title={s.title} />

      {notReady ? <InfoStrip>{s.notReady}</InfoStrip> : null}
      {errorKey ? (
        <p role="alert" className={field.error}>
          {s[errorKey]}
        </p>
      ) : null}
      {saved && !errorKey ? (
        <p role="status">
          <Pill tone="ok">{s.saved}</Pill>
        </p>
      ) : null}

      <p className="flex flex-wrap items-center gap-x-2 text-[16px] text-ink">
        <span className="font-semibold">{s.link}</span>
        <Link href="/team/login" className="break-all font-semibold text-ink underline decoration-brand decoration-2 underline-offset-4 hover:decoration-ink focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink">
          <Ltr>{loginUrl}</Ltr>
        </Link>
      </p>

      {notReady ? null : (
        <>
          <Panel title={s.add}>
            <form action={createStaffAction} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="staff-name" className={field.label}>{s.name}</Label>
                <Input id="staff-name" name="name" required maxLength={60} autoComplete="off" className={field.input} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="staff-phone" className={field.label}>{s.phone}</Label>
                <Input id="staff-phone" name="phone" type="tel" inputMode="numeric" required autoComplete="off" dir="ltr" className={field.input} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="staff-password" className={field.label}>{s.password}</Label>
                <Input
                  id="staff-password"
                  name="password"
                  type="text"
                  required
                  minLength={STAFF_PASSWORD_MIN}
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="none"
                  dir="ltr"
                  className={field.input}
                />
              </div>
              <div className="sm:col-span-3">
                <PendingSubmit shadcn className={btn.primary}>
                  {s.add}
                </PendingSubmit>
              </div>
            </form>
          </Panel>

          {accounts.length === 0 ? (
            <EmptyState icon={Users} title={s.empty} />
          ) : (
            <ul className="flex flex-col gap-3">
              {accounts.map((a) => (
                <li key={a.id}>
                  <Panel as="div" bodyClassName="flex flex-col gap-4">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <span className="text-[18px] font-bold text-ink">{a.name}</span>
                      <Ltr className="text-[16px] font-medium text-ink">{formatPhoneLocal(a.phone)}</Ltr>
                      {a.active ? <Pill tone="ok">{s.active}</Pill> : <Pill tone="warn">{s.disabled}</Pill>}
                      <span className="text-[15px] text-ink-muted">
                        {fillLtr(s.todayCount, { n: used.get(`staff:${a.id}`) ?? 0, max: STAFF_IMAGE_DAILY_LIMIT })}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                      <form action={setStaffActiveAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="active" value={a.active ? 'false' : 'true'} />
                        <PendingSubmit className={a.active ? btn.danger : btn.outline}>
                          {a.active ? s.disable : s.enable}
                        </PendingSubmit>
                      </form>
                      <form action={resetStaffPasswordAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="id" value={a.id} />
                        <div className="flex flex-col gap-1">
                          <Label htmlFor={`pw-${a.id}`} className={field.label}>{s.password}</Label>
                          <Input
                            id={`pw-${a.id}`}
                            name="password"
                            type="text"
                            required
                            minLength={STAFF_PASSWORD_MIN}
                            autoComplete="off"
                            spellCheck={false}
                            autoCapitalize="none"
                            dir="ltr"
                            className={`${field.input} w-56`}
                          />
                        </div>
                        <PendingSubmit className={btn.outline}>
                          {s.resetPassword}
                        </PendingSubmit>
                      </form>
                    </div>
                  </Panel>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
