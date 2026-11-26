import { cn } from '@/lib/utils';

/** Shared class builders and types of the collage kit (see docs/DESIGN_SYSTEM.md). Plain strings, so any file can use them. */

export type ScrapTone = 'white' | 'navy' | 'red' | 'news' | 'grid' | 'tape' | 'discount';
export type ScrapFont = 'lalezar' | 'rakkas' | 'kufi' | 'marker' | 'body';
export type ScrapEdge = 'torn' | 'torn4' | 'tornb' | 'square';
export type ScrapSize = 'tag' | 'sm' | 'md' | 'lg' | 'xl';
/** Tilt in degrees. Scraps and tags stay between -3 and 3. */
export type Tilt = -3 | -2 | -1.5 | -1 | 0 | 1 | 1.5 | 2 | 3;

/** Static rotate classes per tilt (written out so Tailwind's scanner sees them). */
export const TILT: Record<Tilt, string> = {
  '-3': '-rotate-3',
  '-2': '-rotate-2',
  '-1.5': '-rotate-[1.5deg]',
  '-1': '-rotate-1',
  '0': '',
  '1': 'rotate-1',
  '1.5': 'rotate-[1.5deg]',
  '2': 'rotate-2',
  '3': 'rotate-3',
};

const TONE: Record<ScrapTone, string> = {
  white: 'scrap-white',
  navy: 'scrap-navy',
  red: 'scrap-red',
  news: 'scrap-news',
  grid: 'scrap-grid',
  tape: 'scrap-tape',
  discount: 'scrap-discount',
};

const EDGE: Record<ScrapEdge, string> = {
  torn: '',
  torn4: 'scrap-torn4',
  tornb: 'scrap-tornb',
  square: 'scrap-square',
};

const FONT: Record<ScrapFont, string> = {
  lalezar: 'font-lalezar font-normal',
  rakkas: 'font-rakkas font-normal',
  kufi: 'font-kufi font-black',
  marker: 'font-marker font-bold',
  body: 'font-sans font-bold',
};

const SIZE: Record<ScrapSize, string> = {
  tag: 'px-2.5 pt-1.5 pb-2 text-[14px] leading-snug',
  sm: 'px-3 pt-0.5 pb-2 text-[20px] sm:text-[22px] leading-[1.25]',
  md: 'px-4 pt-1 pb-2.5 text-[24px] sm:text-[28px] leading-[1.25]',
  lg: 'px-5 pt-1 pb-3 text-[32px] sm:text-[42px] leading-[1.2]',
  xl: 'px-4 pt-1 pb-3.5 text-[38px] sm:px-6 sm:text-[52px] md:text-[60px] leading-[1.2]',
};

/**
 * Class string of one torn paper scrap: tone, font, edge and size. Includes `inline-block` (override with `block`/`inline-flex` through cn).
 * Never add `bg-*` or filter utilities to it.
 */
export function scrapCls({
  tone = 'white',
  font = 'lalezar',
  edge = 'torn',
  size = 'md',
}: { tone?: ScrapTone; font?: ScrapFont; edge?: ScrapEdge; size?: ScrapSize } = {}): string {
  return cn('scrap inline-block', TONE[tone], EDGE[edge], FONT[font], SIZE[size]);
}

const CTA_SIZE = {
  sm: 'min-h-11 px-4 pt-1 pb-2.5 text-lg',
  md: 'min-h-12 px-7 pt-1.5 pb-3 text-[22px]',
  lg: 'min-h-14 w-full px-8 pt-2 pb-3.5 text-[26px]',
} as const;

/**
 * The main call to action: a red torn scrap in Lalezar, tilted, straightens on hover.
 * For `<Link>`, `<a>`, `<button>` and the shadcn `<Button className>` (neutralises its bg, border, radius and height).
 */
export function ctaCls(size: keyof typeof CTA_SIZE = 'md'): string {
  return `scrap cta inline-flex items-center justify-center gap-2 whitespace-nowrap h-auto rounded-none border-0 bg-transparent hover:bg-transparent font-normal ${CTA_SIZE[size]}`;
}

/** Class string of a small torn label (Tag). */
export function tagCls(tone: ScrapTone = 'navy'): string {
  return cn(scrapCls({ tone, font: 'body', size: 'tag' }), 'inline-flex items-center gap-1');
}

/* Buttons and form fields for forms, dialogs and admin pages. Flat, square, 44px, navy focus outline. */
const BTN_BASE =
  'inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-[2px] px-5 text-[16px] font-bold transition-colors focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink disabled:pointer-events-none disabled:opacity-60';

/** Shared base of every flat button (h-11, square, navy focus outline). `outline-solid` is needed when the element is a shadcn Button, whose `outline-none` would otherwise hide the outline. */
export { BTN_BASE };

const BTN_VARIANT = {
  ink: 'bg-ink text-paper hover:bg-ink-hover',
  outline: 'border border-ink/30 bg-white text-ink hover:bg-news',
  danger: 'border border-brand-ink/40 bg-white text-brand-ink hover:bg-brand-tint',
} as const;

/**
 * Secondary and form buttons (NOT the main CTA, that is `ctaCls`): `ink` solid navy, `outline` white with a hairline,
 * `danger` an outline in red text (never a filled red). For `<button>`, `<Link>`, `<a>` and the shadcn `<Button className>`.
 */
export function btnCls(variant: keyof typeof BTN_VARIANT = 'ink'): string {
  return `${BTN_BASE} ${BTN_VARIANT[variant]}`;
}

/**
 * Class strings for form pieces. `input` on Input/Textarea, `select` on SelectTrigger (it overrides the frozen `h-8`),
 * `label` on `<label>`, `hint` for helper text, `error` for error text (keep `role="alert"` / `aria-live` where it exists).
 */
export const fieldCls = {
  input: 'h-11 rounded-[2px] border-input bg-white px-3 text-[16px] md:text-[16px] focus-visible:border-brand focus-visible:ring-brand/30',
  select: 'w-full rounded-[2px] border-input bg-white text-[16px] data-[size=default]:h-11 focus-visible:border-brand focus-visible:ring-brand/30',
  label: 'text-[15px] font-bold leading-normal text-ink',
  hint: 'text-[14px] leading-[1.4] text-ink-muted',
  error: 'text-[14px] leading-[1.4] text-brand-ink',
} as const;

/** Class string of a flat card for forms and data: white, square, paper shadow. `grid` = squared paper, `news` = newsprint. */
export function paperCardCls(tone: 'white' | 'grid' | 'news' = 'white'): string {
  return cn('paper-card relative', tone === 'grid' && 'grid-paper', tone === 'news' && 'bg-news');
}
