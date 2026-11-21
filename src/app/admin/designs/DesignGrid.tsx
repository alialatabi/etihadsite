import Link from 'next/link';
import { Ltr } from '@/components/Ltr';
import { Pill } from '@/components/admin/kit';
import { admin } from '@/content/ar';
import { shapeLabel, sizeLabel } from '@/lib/order-text';
import type { AiGenerationRecord } from '@/lib/types';
import { formatBaghdad } from '../_lib';

const d = admin.designs;

/** Cards of generated designs, newest first. Server component: no state. */
export function DesignGrid({ rows }: { rows: AiGenerationRecord[] }) {
  return (
    <ul className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {rows.map((g) => (
        <li
          key={g.id}
          className="flex flex-col gap-3 overflow-hidden rounded-xl border border-[#e7dfdf] bg-white p-3 shadow-[0_10px_28px_-18px_rgba(18,31,52,0.25)]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- admin-only, auth-guarded route; next/image would re-fetch it unauthenticated */}
          <img
            src={`/api/admin/designs/${g.uploadId}/image`}
            alt=""
            loading="lazy"
            className="aspect-square w-full rounded-lg border border-[#e7dfdf] bg-[#f7f0ef] object-contain"
          />
          <div className="flex flex-col gap-2 px-1 pb-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[14px] font-medium leading-[1.4] text-[#5a6475]">{formatBaghdad(g.createdAt)}</span>
              {g.orderId ? (
                <Link
                  href={`/admin/orders/${g.orderId}`}
                  className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d01c4a]"
                >
                  <Pill tone="ok">{d.ordered}</Pill>
                </Link>
              ) : null}
            </div>
            <p className="text-[15px] font-bold leading-normal text-[#121f34]">
              {shapeLabel(g.shape, g.corners)} · <Ltr>{sizeLabel(g.widthUm, g.heightUm)}</Ltr>
            </p>
            <p className="line-clamp-3 break-words text-[15px] leading-normal text-[#121f34]">
              <span className="text-[14px] text-[#5a6475]">{d.idea}: </span>
              {g.idea}
            </p>
            {g.lines.length > 0 ? (
              <p className="break-words text-[15px] leading-normal text-[#121f34]">
                <span className="text-[14px] text-[#5a6475]">{d.printed}: </span>
                {g.lines.join(' / ')}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
