import type { ComponentType, ReactNode, SVGProps } from 'react';
import { Check, Inbox } from 'lucide-react';
import { order } from '@/content/ar';
import type { OrderStatus } from '@/lib/types';

/**
 * Softy admin kit: the only styling vocabulary admin pages import (server-safe, no client code).
 * Palette: paper #fdfbfa, ink #121f34, brand red #d01c4a (one primary action per screen),
 * surface #f7f0ef, border #e7dfdf, secondary text #5a6475. Lime is for discounts only.
 */

const CARD_SHADOW = 'shadow-[0_10px_28px_-18px_rgba(18,31,52,0.25)]';

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
  /** Secondary line under the title (16px, #5a6475). */
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
          <h1 className="text-[24px] font-bold leading-tight text-[#121f34] sm:text-[30px]">{title}</h1>
          {children}
        </div>
        {description ? <p className="mt-2 text-[16px] leading-[1.7] text-[#5a6475]">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * White card with a Softy border and soft shadow. Optional header row: `<h2>` title (18/700),
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
    <Tag className={cx('rounded-xl border border-[#e7dfdf] bg-white', CARD_SHADOW, className)}>
      {hasHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5">
          <div className="min-w-0">
            {title ? <h2 className="text-[18px] font-bold leading-[1.4] text-[#121f34]">{title}</h2> : null}
            {description ? <p className="mt-1 text-[15px] leading-normal text-[#5a6475]">{description}</p> : null}
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
      className={cx(
        'rounded-xl border p-5',
        CARD_SHADOW,
        ink ? 'border-[#121f34] bg-[#121f34] text-[#fdfbfa]' : 'border-[#e7dfdf] bg-white text-[#121f34]',
        className,
      )}
    >
      <p className={cx('text-[14px] font-medium leading-[1.4]', ink ? 'text-[#fdfbfa]/75' : 'text-[#5a6475]')}>{label}</p>
      <p className="mt-1 text-[30px] font-bold leading-tight tabular-nums">{value}</p>
      {hint ? <p className={cx('mt-1 text-[14px] leading-[1.4]', ink ? 'text-[#fdfbfa]/75' : 'text-[#5a6475]')}>{hint}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tables                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Bordered, scrollable box for a shadcn `<Table>`: wide tables scroll inside it, never the page.
 * `label` becomes the accessible name of the scroll region (keyboard users can scroll it).
 */
export function TableFrame({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <div
      className={cx('overflow-x-auto rounded-xl border border-[#e7dfdf] bg-white', CARD_SHADOW, className)}
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
  head: 'h-11 bg-[#f7f0ef] px-4 text-[14px] font-semibold text-[#5a6475] whitespace-nowrap',
  row: 'border-[#e7dfdf] hover:bg-[#fdfbfa]',
  cell: 'px-4 py-3 text-[15px] align-middle',
  num: 'tabular-nums whitespace-nowrap',
} as const;

/* -------------------------------------------------------------------------- */
/* Pills                                                                       */
/* -------------------------------------------------------------------------- */

const STATUS_TONE: Record<OrderStatus, { box: string; dot: string }> = {
  new: { box: 'bg-[#ffeaed] text-[#b8163f]', dot: 'bg-[#d01c4a]' },
  printing: { box: 'bg-[#f4e8f5] text-[#6b2170]', dot: 'bg-[#8a2b8f]' },
  done: { box: 'bg-[#eef0f4] text-[#121f34]', dot: 'bg-[#121f34]' },
  cancelled: { box: 'bg-[#f7f0ef] text-[#5a6475]', dot: 'bg-[#9aa3b5]' },
};

/** Order status pill: coloured dot + the `order.status[status]` label. */
export function StatusPill({ status, className }: { status: OrderStatus; className?: string }) {
  const tone = STATUS_TONE[status];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1 text-[14px] font-semibold leading-[1.4]',
        tone.box,
        className,
      )}
    >
      <span aria-hidden className={cx('size-2 shrink-0 rounded-full', tone.dot)} />
      {order.status[status]}
    </span>
  );
}

/** Tones of the generic {@link Pill}. `discount` (lime) is ONLY for a discount/saving. */
export type PillTone = 'neutral' | 'info' | 'warn' | 'ok' | 'discount';

const PILL_TONE: Record<PillTone, string> = {
  neutral: 'bg-white text-[#121f34] shadow-[inset_0_0_0_1px_#e7dfdf]',
  info: 'bg-[#f4e8f5] text-[#6b2170]',
  warn: 'bg-[#ffeaed] text-[#b8163f]',
  ok: 'bg-[#eef0f4] text-[#121f34]',
  discount: 'bg-[#b6ff1a] text-[#1a2e05]',
};

/**
 * Small tag for non-order-status facts (Telegram sent/failed/skipped, opted in, blocked, alerts).
 * `ok` shows a check icon. Do not use `discount` for success/done.
 */
export function Pill({ tone = 'neutral', children, className }: { tone?: PillTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[14px] font-semibold leading-[1.4]',
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
      className={cx(
        'flex flex-col items-center gap-2 rounded-xl border border-[#e7dfdf] bg-white px-5 py-12 text-center',
        CARD_SHADOW,
        className,
      )}
    >
      <Icon aria-hidden className="size-7 text-[#9aa3b5]" />
      <p className="text-[18px] font-bold leading-[1.4] text-[#121f34]">{title}</p>
      {children ? <div className="max-w-md text-[15px] leading-normal text-[#5a6475]">{children}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Buttons                                                                     */
/* -------------------------------------------------------------------------- */

const BTN_BASE =
  'inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-5 text-[16px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d01c4a] disabled:pointer-events-none disabled:opacity-60';

/**
 * Class strings for buttons, usable on the shadcn `Button` (`className={btn.primary}`),
 * on `<a>`/`<Link>`, or on a plain `<button>`. All are h-11, rounded-xl.
 * `primary` = the ONE red action per screen. `danger` is an outline, never a filled red.
 * `whatsapp` only for WhatsApp.
 */
export const btn = {
  primary: `${BTN_BASE} bg-[#d01c4a] text-white hover:bg-[#b8163f]`,
  ink: `${BTN_BASE} bg-[#121f34] text-[#fdfbfa] hover:bg-[#1b2b46]`,
  outline: `${BTN_BASE} border border-[#e7dfdf] bg-white text-[#121f34] hover:bg-[#f7f0ef]`,
  danger: `${BTN_BASE} border border-[#f3c4cf] bg-white text-[#b8163f] hover:bg-[#ffeaed]`,
  whatsapp: `${BTN_BASE} bg-[#25d366] text-[#052e16] hover:bg-[#20bd5a]`,
} as const;

/**
 * Segmented-pill class for filters/range controls: selected = 2px ink border + bold,
 * unselected = 1px border + secondary text. Pair with `aria-current`/`aria-pressed` on the element.
 */
export function segment(selected: boolean): string {
  return cx(
    'inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-white px-4 text-[15px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d01c4a]',
    selected
      ? 'border-2 border-[#121f34] font-bold text-[#121f34]'
      : 'border border-[#e7dfdf] font-medium text-[#5a6475] hover:bg-[#f7f0ef]',
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
export const field = {
  input:
    'h-11 rounded-xl border-[#e7dfdf] bg-white px-3 text-[16px] focus-visible:border-[#d01c4a] focus-visible:ring-[#d01c4a]/30',
  label: 'text-[15px] font-semibold leading-normal text-[#121f34]',
  hint: 'text-[14px] leading-[1.4] text-[#5a6475]',
  error: 'text-[14px] leading-[1.4] text-[#b8163f]',
} as const;

/** Panel-style info strip (surface background) for notices such as "list capped". */
export function InfoStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('rounded-xl border border-[#e7dfdf] bg-[#f7f0ef] px-4 py-3 text-[15px] leading-normal text-[#5a6475]', className)}>
      {children}
    </div>
  );
}
