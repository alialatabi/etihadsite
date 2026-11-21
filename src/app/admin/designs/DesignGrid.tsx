import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Ltr } from '@/components/Ltr';
import { admin } from '@/content/ar';
import { shapeLabel, sizeLabel } from '@/lib/order-text';
import type { AiGenerationRecord } from '@/lib/types';
import { formatBaghdad } from '../_lib';

const d = admin.designs;

/** Cards of generated designs, newest first. Server component: no state. */
export function DesignGrid({ rows }: { rows: AiGenerationRecord[] }) {
  return (
    <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {rows.map((g) => (
        <li key={g.id} className="flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element -- admin-only, auth-guarded route; next/image would re-fetch it unauthenticated */}
          <img
            src={`/api/admin/designs/${g.uploadId}/image`}
            alt=""
            loading="lazy"
            className="aspect-square w-full bg-muted object-contain"
          />
          <div className="flex flex-col gap-2 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-muted-foreground">
                <Ltr>{formatBaghdad(g.createdAt)}</Ltr>
              </span>
              {g.orderId ? (
                <Link href={`/admin/orders/${g.orderId}`}>
                  <Badge>{d.ordered}</Badge>
                </Link>
              ) : null}
            </div>
            <p className="font-medium">
              {shapeLabel(g.shape, g.corners)} · <Ltr>{sizeLabel(g.widthUm, g.heightUm)}</Ltr>
            </p>
            <p className="line-clamp-3 break-words">
              <span className="text-muted-foreground">{d.idea}: </span>
              {g.idea}
            </p>
            {g.lines.length > 0 ? (
              <p className="break-words">
                <span className="text-muted-foreground">{d.printed}: </span>
                {g.lines.join(' / ')}
              </p>
            ) : null}
            <Ltr className="text-xs text-muted-foreground">{g.ip}</Ltr>
          </div>
        </li>
      ))}
    </ul>
  );
}
