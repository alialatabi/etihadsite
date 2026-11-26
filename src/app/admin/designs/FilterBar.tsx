import Link from 'next/link';
import { Search } from 'lucide-react';
import { btn, field, Panel } from '@/components/admin/kit';
import { admin } from '@/content/ar';
import { shapeLabel } from '@/lib/order-text';
import { cn } from '@/lib/utils';
import type { DesignFilters } from './filters';

const f = admin.designs.filters;

// Plain HTML controls (no shadcn parts): the kit's field look plus a border and the ink focus outline.
const CONTROL = cn(
  field.input,
  'w-full min-w-0 border text-ink focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink',
);
const LABEL = field.label;

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
              <input type="date" name="from" defaultValue={values.from} dir="ltr" className={cn(CONTROL, 'px-2')} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className={LABEL}>{f.to}</span>
              <input type="date" name="to" defaultValue={values.to} dir="ltr" className={cn(CONTROL, 'px-2')} />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={btn.ink}>
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
