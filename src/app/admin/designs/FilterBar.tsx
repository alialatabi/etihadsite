import Link from 'next/link';
import { Search } from 'lucide-react';
import { btn, Panel } from '@/components/admin/kit';
import { admin } from '@/content/ar';
import { shapeLabel } from '@/lib/order-text';
import type { DesignFilters } from './filters';

const f = admin.designs.filters;

const CONTROL =
  'h-11 w-full min-w-0 rounded-xl border border-[#e7dfdf] bg-white px-3 text-[16px] text-[#121f34] focus-visible:border-[#d01c4a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d01c4a]';
const LABEL = 'text-[15px] font-semibold leading-normal text-[#121f34]';

export interface StaffOption {
  id: string;
  name: string;
}

/** Plain GET form (no client JS): every control is a query parameter of /admin/designs. */
export function FilterBar({ values, staff }: { values: DesignFilters['echo']; staff: StaffOption[] }) {
  return (
    <Panel>
      <form method="get" action="/admin/designs" role="search" aria-label={f.label} className="flex flex-col gap-4">
        {values.ip ? <input type="hidden" name="ip" value={values.ip} /> : null}

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>{f.search}</span>
          <input
            type="search"
            name="q"
            defaultValue={values.q}
            maxLength={100}
            placeholder={f.searchPlaceholder}
            enterKeyHint="search"
            className={CONTROL}
          />
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>{f.status}</span>
            <select name="status" defaultValue={values.status} className={CONTROL}>
              <option value="">{f.statusAll}</option>
              <option value="ordered">{f.statusOrdered}</option>
              <option value="unordered">{f.statusUnordered}</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>{f.maker}</span>
            <select name="maker" defaultValue={values.maker} className={CONTROL}>
              <option value="">{f.makerAll}</option>
              <option value="customer">{f.makerCustomers}</option>
              <option value="staff">{f.makerStaff}</option>
              {staff.map((s) => (
                <option key={s.id} value={`staff:${s.id}`}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>{f.shape}</span>
            <select name="shape" defaultValue={values.shape} className={CONTROL}>
              <option value="">{f.shapeAll}</option>
              <option value="circle">{shapeLabel('circle')}</option>
              <option value="rect">{f.shapeRect}</option>
              <option value="custom">{shapeLabel('custom')}</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className={LABEL}>{f.from}</span>
              <input type="date" name="from" defaultValue={values.from} dir="ltr" className={CONTROL} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className={LABEL}>{f.to}</span>
              <input type="date" name="to" defaultValue={values.to} dir="ltr" className={CONTROL} />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={btn.primary}>
            <Search aria-hidden className="size-5" />
            {f.submit}
          </button>
          <Link href={values.ip ? `/admin/designs?ip=${values.ip}` : '/admin/designs'} className={btn.outline}>
            {f.clear}
          </Link>
        </div>
      </form>
    </Panel>
  );
}
