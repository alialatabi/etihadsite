import type { ComponentType, ReactNode, SVGProps } from 'react';
import { Check, Inbox } from 'lucide-react';
import { order } from '@/content/ar';
import { BTN_BASE, btnCls, fieldCls } from '@/components/collage';
import type { OrderStatus } from '@/lib/types';

/**
 * Softy admin kit: the only styling vocabulary admin pages import (server-safe, no client code).
 * Softy «قص ولزق» collage system, calm version (docs/DESIGN_SYSTEM.md): flat white cards with square corners
 * and the paper shadow, navy ink, red for the ONE primary action per screen. The collage marks only the page
 * title (a navy scrap), the stat tiles and the badges. Lime is for discounts only.
 */

const CARD = 'rounded-[2px] bg-white shadow-paper';

/** Joins truthy class strings (tiny local helper; keeps the kit free of imports from ui code). */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** A lucide-style icon component (outline, takes className/size props). */
export type KitIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

/* -------------------------------------------------------------------------- */
/* Page header                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Page header: `<h1>` in the page-title style, optional description, `actions` at the end.
 * `children` render in the SAME wrapper as the `<h1>` (e.g. a StatusPill beside the order number),
 * so `h1.parentElement` contains them.
 */
export function AdminPageHeader({
  title,
  description,
  actions,
  children,
  className,
}: {
  /** Heading content (a string, or `<Ltr>` for ids). */
  title: ReactNode;
  /** Secondary line under the title (16px, ink-muted). */
  description?: ReactNode;
  /** Buttons/links at the end of the header. */
  actions?: ReactNode;
  /** Rendered inside the same flex row as the h1 (after it). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx('mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className)}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="scrap scrap-navy inline-block -rotate-1 px-4 pt-1 pb-2.5 font-lalezar text-[26px] font-normal leading-[1.25] sm:text-[32px]">{title}</h1>
          {children}
        </div>
        {description ? <p className="mt-3 text-[16px] leading-[1.7] text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * White paper card with the paper shadow. Optional header row: `<h2>` title (18/700),
 * description (15px), `actions` at the end. `bodyClassName` is appended to the body wrapper `p-5` (use `!p-0` to drop the padding, e.g. for a table inside).
 */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  as: Tag = 'section',
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Extra classes for the body wrapper (default padding is `p-5`). */
  bodyClassName?: string;
  /** Root element, default `section`. */
  as?: 'section' | 'div' | 'article' | 'aside';
}) {
  const hasHeader = Boolean(title || description || actions);
  return (
    <Tag className={cx(CARD, className)}>
      {hasHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5">
          <div className="min-w-0">
            {title ? <h2 className="text-[18px] font-bold leading-[1.4] text-ink">{title}</h2> : null}
            {description ? <p className="mt-1 text-[15px] leading-normal text-ink-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children !== undefined && children !== null ? <div className={cx('p-5', bodyClassName)}>{children}</div> : null}
    </Tag>
  );
}

/* -------------------------------------------------------------------------- */
/* StatTile                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One KPI: small label, big tabular value, optional hint. `tone="ink"` is the dark tile
 * (use for the single most important KPI). Never red.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
  className,
}: {
  label: ReactNode;
  /** The number or short value (wrap digits in `<Ltr>`/`<Money>` yourself if mixed with text). */
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'ink';
  className?: string;
}) {
  const ink = tone === 'ink';
  return (
    <div
      className={cx('rounded-[2px] p-5 shadow-paper', ink ? 'bg-ink text-paper' : 'grid-paper bg-white text-ink', className)}
    >
      <p className={cx('text-[14px] font-semibold leading-[1.4]', ink ? 'text-paper/80' : 'text-ink-muted')}>{label}</p>
      <p className="mt-1 font-lalezar text-[34px] font-normal leading-[1.15] tabular-nums">{value}</p>
      {hint ? <p className={cx('mt-1 text-[14px] leading-[1.4]', ink ? 'text-paper/80' : 'text-ink-muted')}>{hint}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tables                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Paper-card scrollable box for a shadcn `<Table>`: wide tables scroll inside it, never the page.
 * `label` becomes the accessible name of the scroll region (keyboard users can scroll it).
 */
export function TableFrame({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <div
      className={cx('overflow-x-auto rounded-[2px] bg-white shadow-paper focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink', className)}
      {...(label ? { role: 'region', 'aria-label': label, tabIndex: 0 } : {})}
    >
      {children}
    </div>
  );
}

/**
 * Class strings for the shadcn Table parts:
 * `TableHead className={tableCls.head}`, `TableRow className={tableCls.row}`,
 * `TableCell className={tableCls.cell}`, numeric cells add `tableCls.num`.
 */
export const tableCls = {
  head: 'h-11 bg-news px-4 text-[14px] font-bold text-ink-soft whitespace-nowrap',
  row: 'border-line hover:bg-news-light',
  cell: 'px-4 py-3 text-[15px] align-middle',
  num: 'tabular-nums whitespace-nowrap',
} as const;

/* -------------------------------------------------------------------------- */
/* Pills                                                                       */
/* -------------------------------------------------------------------------- */

const STATUS_TONE: Record<OrderStatus, { box: string; dot: string }> = {
  new: { box: 'bg-brand-tint text-brand-ink', dot: 'bg-brand' },
  printing: { box: 'bg-tape text-ink', dot: 'bg-ink' },
  done: { box: 'bg-ink text-paper', dot: 'bg-paper' },
  cancelled: { box: 'bg-news-dark text-ink-soft', dot: 'bg-ink/40' },
};

/** Order status pill: coloured dot + the `order.status[status]` label. */
export function StatusPill({ status, className }: { status: OrderStatus; className?: string }) {
  const tone = STATUS_TONE[status];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-2 whitespace-nowrap rounded-[2px] px-2.5 py-1 text-[14px] font-bold leading-[1.4]',
        tone.box,
        className,
      )}
    >
      <span aria-hidden className={cx('size-2 shrink-0 rounded-[50%]', tone.dot)} />
      {order.status[status]}
    </span>
  );
}

/** Tones of the generic {@link Pill}. `discount` (lime) is ONLY for a discount/saving. */
export type PillTone = 'neutral' | 'info' | 'warn' | 'ok' | 'discount';

const PILL_TONE: Record<PillTone, string> = {
  neutral: 'bg-white text-ink shadow-[inset_0_0_0_1px_rgb(18_31_52/0.25)]',
  info: 'bg-news text-ink',
  warn: 'bg-brand-tint text-brand-ink',
  ok: 'bg-ink text-paper',
  discount: 'bg-discount text-discount-foreground',
};

/**
 * Small tag for non-order-status facts (Telegram sent/failed/skipped, opted in, blocked, alerts).
 * `ok` shows a check icon. Do not use `discount` for success/done.
 */
export function Pill({ tone = 'neutral', children, className }: { tone?: PillTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[2px] px-2.5 py-1 text-[14px] font-bold leading-[1.4]',
        PILL_TONE[tone],
        className,
      )}
    >
      {tone === 'ok' ? <Check aria-hidden className="size-4 shrink-0" /> : null}
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                 */
/* -------------------------------------------------------------------------- */

/** Centered empty box: outline icon (default Inbox), title, optional explanation/children. */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  children,
  className,
}: {
  icon?: KitIcon;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx('flex flex-col items-center gap-3 px-5 py-12 text-center', CARD, className)}
    >
      <span className="grid size-16 place-items-center rounded-[50%] bg-news">
        <Icon aria-hidden className="size-7 text-ink-muted" />
      </span>
      <p className="text-[18px] font-bold leading-[1.4] text-ink">{title}</p>
      {children ? <div className="max-w-md text-[15px] leading-normal text-ink-muted">{children}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Buttons                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Class strings for buttons, usable on the shadcn `Button` (`className={btn.primary}`),
 * on `<a>`/`<Link>`, or on a plain `<button>`. All are h-11, square corners.
 * `primary` = the ONE red action per screen. `danger` is an outline, never a filled red.
 * `whatsapp` only for WhatsApp.
 */
export const btn = {
  primary: `${BTN_BASE} bg-brand text-white hover:bg-brand-ink`,
  ink: btnCls('ink'),
  outline: btnCls('outline'),
  danger: btnCls('danger'),
  whatsapp: `${BTN_BASE} bg-[#25d366] text-[#052e16] hover:bg-[#20bd5a]`,
} as const;

/**
 * Segmented-pill class for filters/range controls: selected = solid ink + bold,
 * unselected = white with a hairline border + secondary text. Pair with `aria-current`/`aria-pressed` on the element.
 */
export function segment(selected: boolean): string {
  return cx(
    'inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-[2px] px-4 text-[15px] transition-colors focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink',
    selected
      ? 'bg-ink font-bold text-paper'
      : 'border border-ink/25 bg-white font-medium text-ink-soft hover:bg-news',
  );
}

/* -------------------------------------------------------------------------- */
/* Form fields                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Class strings for form pieces: `field.input` on Input/SelectTrigger/Textarea,
 * `field.label` on `<label>`, `field.hint` for helper text, `field.error` for error text
 * (keep `role="alert"` / `aria-live` where it already exists).
 */
export const field = fieldCls;

/** Panel-style info strip (surface background) for notices such as "list capped". */
export function InfoStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('rounded-[2px] bg-news px-4 py-3 text-[15px] leading-normal text-ink-soft shadow-[inset_0_0_0_1px_rgb(18_31_52/0.12)]', className)}>
      {children}
    </div>
  );
}
