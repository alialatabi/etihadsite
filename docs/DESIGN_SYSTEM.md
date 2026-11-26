# Softy design system: «قص ولزق» (cut and paste) on the web

Source: the Softy collage artboards (Dir-D-Base, Col-Rules, Col-Story, Col-Post-1x1, Dir-D-Post). They are social posts; this sheet is how the system translates to the website. **It changes how the site looks, nothing else.** Wording, data, API, PDFs and behaviour stay the same.

## 1. The idea in one paragraph

The page is print-shop paper (a warm ground with a fine grain). Headlines are torn paper scraps stuck on the paper, mixing fonts, with the important word on red. Prices get a red marker circle. Numbers and steps sit on squared paper. Everything you read to understand or fill in (forms, tables, builder controls, admin data) stays **flat, unrotated, clean**: white cards with square corners, navy ink and a paper shadow. Most of the interface is clean. The collage marks only the few things that matter.

## 2. Tokens (src/app/globals.css)

| Token (CSS var) | Value | Tailwind | Use |
|---|---|---|---|
| `--ground` | `#ECE6DA` | `bg-ground` | page ground (= `--background`, with the grain on `body`) |
| `--news` | `#F4EFE4` | `bg-news` | newsprint scrap, table heads, muted surfaces (= `--muted`, `--secondary`) |
| `--news-light` | `#F7F3EA` | `bg-news-light` | lighter newsprint, row hover (= `--accent`) |
| `--paper` | `#FDFBFA` | `text-paper` `bg-paper` | cream: text on navy |
| `--ink` | `#121F34` | `text-ink` `bg-ink` | ink navy: text and navy scraps (= `--foreground`, `--primary`) |
| `--ink-soft` | `#3D4659` | `text-ink-soft` | secondary text |
| `--ink-muted` | `#4A5265` | `text-ink-muted` | hints and labels (= `--muted-foreground`) |
| `--ink-hover` | `#1B2B46` | `bg-ink-hover` | hover on navy surfaces |
| `--brand` | `#D01C4A` | `bg-brand` `text-brand` | THE red: the one red word, the main CTA, the marker |
| `--brand-ink` | `#B8163F` | `text-brand-ink` | small red text (under 24px), errors (= `--destructive`) |
| `--brand-tint` | `#FBE4EA` | `bg-brand-tint` | error and warning box background |
| `--tape` | `rgb(255 154 31 / .82)` | `bg-tape` | orange tape. **Text on it is always navy** |
| `--discount` / `--discount-foreground` | `#B6FF1A` / `#1A2E05` | `bg-discount text-discount-foreground` | **discounts only** |
| `--line` | `#D3CAB9` | `border-line` | hairlines and dividers (= `--border`) |
| `--input` | `#7D8391` | `border-input` | form field borders (3:1 on white) |
| `--ring` | `#D01C4A` | ring | focus ring of shadcn parts (full strength, see §8) |
| `--radius` | `2px` | all `rounded-sm…4xl` | paper has no radius; every `rounded-*` token resolves to 2px |
| `--paper-shadow` | `0 14px 22px -12px rgb(30 24 12/.45), 0 0 0 1px rgb(18 31 52/.06)` | `shadow-paper` | cards (box-shadow: never on a clipped element) |
| logo gradient | conic `#FF9A1F → #EE3A62 → #8A2B8F` | `.cut-circle`, `bg-brand-gradient` | **only inside a cut circle** |

Other variables in `:root`: `--paper-drop` (the scrap's drop-shadow filter), `--sticker-edge`, `--sticker-edge-sm`, `--grid-line`, `--pattern-news`, `--pattern-grid`, `--logo-gradient`, and the three torn edges `--torn-edge`, `--torn-four`, `--torn-bottom` (copied verbatim from the artboards).

Fonts (next/font in layout.tsx): `font-sans` = IBM Plex Sans Arabic (400/500/600/700): ALL body, labels, explanations, forms, tables. Display, for headline scraps, CTAs, big numbers and prices only: `font-lalezar` (400), `font-rakkas` (400), `font-kufi` (Noto Kufi Arabic 900, always with `font-black`), `font-marker` (Aref Ruqaa 700, handwritten marker notes). Lalezar and Rakkas are single weight: always `font-normal`, never `font-bold` (that makes a fake bold). Only Plex and Lalezar are preloaded; the other three load when first used.

## 3. Utilities (globals.css, `@layer components`, so any Tailwind utility overrides them)

- `scrap`: a torn paper piece. The torn background is drawn on `::before` with clip-path, so **the element itself is never clipped**: text, focus outline, ref and tabIndex all work, and the paper shadow is `filter: drop-shadow` on the element. Combine with a tone: `scrap-white`, `scrap-navy`, `scrap-red`, `scrap-news` (newsprint with ruled lines), `scrap-grid` (squared paper), `scrap-tape` (straight edges, orange, navy text), `scrap-discount` (lime, discounts only). Edge: default torn top and bottom, `scrap-torn4` (all four sides), `scrap-tornb` (bottom only: header bars), `scrap-square` (no tear). `scrap-flat` removes the shadow. A `scrap-tornb` bar loses up to 12px of its bottom edge to the tear, so give it bottom padding (`pb-2` on the public header, `pb-1.5` on the admin bar).
- `cta`: the main call to action. Red torn scrap, Lalezar, white text, tilted -2deg, straightens on hover. Use it through `ctaCls(size)`, never by hand.
- `paper-card`: a flat white card with the paper shadow (forms and data). With `grid-paper` it becomes squared paper; with `bg-news` it becomes newsprint.
- Patterns (decoration only, never under running text): `news-lines`, `grid-paper`, `halftone`. Clip shapes for decorative pieces: `torn`, `torn4`, `tornb`.
- `paper-drop`, `sticker-edge` / `sticker-edge-sm`: a white die-cut edge plus a shadow (filter) for the logo mark and product images.
- `tape-strip` (orange) and `tape-clear` (translucent white): decorative tape. **Corners only.**
- `cut-circle`: the logo gradient in a circle with a 7px white ring.
- `dashed-divider`: 3px dashed `rgb(18 31 52/.45)` top border. The legacy `cut-line` now draws the same thing.
- `marker-note`: Aref Ruqaa 700 in red. At least 24px, or on a white or news card.
- Motion: `anim-slap` (a scrap lands: 0.5s, stagger with `animationDelay` in 120ms steps), `anim-draw` (the marker draws, on SVG paths with `pathLength=1`), `anim-flutter` (paper sways, 4s infinite). All three are off under `prefers-reduced-motion`.
- Legacy names kept and redefined: `glass` = white card with the paper shadow; `bg-brand-gradient` = the logo gradient (decorative); `bg-brand-gradient-cta` = solid red. Migrate away from them; do not use them in new code.

## 4. Kit (`import { … } from '@/components/collage'`; server-safe, no client JS, usable inside client components)

The class helpers live in `src/components/collage/classes.ts` (not `scrap.ts`: on Windows `scrap.ts` and `Scrap.tsx` collide in TypeScript's case-insensitive file check). Always import from the barrel `@/components/collage`.

| Component / helper | Props | Renders |
|---|---|---|
| `scrapCls({tone, font, edge, size})` | tone `white\|navy\|red\|news\|grid\|tape\|discount`; font `lalezar\|rakkas\|kufi\|marker\|body`; edge `torn\|torn4\|tornb\|square`; size `tag\|sm\|md\|lg\|xl` | class string |
| `ctaCls(size='md')` | `sm` (min-h-11, header), `md` (min-h-12), `lg` (min-h-14, full submit) | class string for `<Link>`, `<a>`, `<button>` and the shadcn `<Button className>` (it neutralises Button's bg, border, radius and height) |
| `tagCls(tone)`, `paperCardCls(tone)` | | class strings behind `Tag` and `PaperCard` |
| `TILT` | keys `-3 -2 -1.5 -1 0 1 1.5 2 3` | static rotate classes |
| `<Scrap>` | `as` (span p div h1 h2 h3 li), tone, font, edge, size, `tilt`, className, `id`, `ref`, rest | one element = one scrap |
| `<ScrapHeadline>` | `text: string`, `as='h1'\|'h2'\|'p'`, `red='last'\|'first'\|'none'\|index`, `size='md'\|'lg'\|'xl'`, `maxScraps=5`, `animate`, `id`, `tabIndex`, `ref`, className | ONE heading element. Inside it, one inline-block scrap per word, real spaces between them, so the heading's text and accessible name equal `text` exactly. Over `maxScraps` words, neighbouring words are grouped. Exactly one red scrap (Lalezar); the others cycle white+Kufi, navy+Rakkas, news+Lalezar, with tilts -3, 2, -2, 3, -1 |
| `<SectionTitle>` | `as='h2'\|'h1'\|'h3'`, `tone='navy'\|'white'\|'red'`, `size='md'\|'sm'`, `tilt=-1.5`, `id`, `tabIndex`, `ref`, className, children | the heading itself is one navy Lalezar scrap (text not split) |
| `<Tag>` | tone (`navy`), `tilt=0`, `as='span'\|'p'`, className, children | small torn label, 14px bold Plex |
| `<Tape>` | `children?` (label) or `strip='orange'\|'clear'` (decorative, aria-hidden), `tilt=-2`, className | orange tape label with navy text / tape strip |
| `<StickerMark>` | `size=40`, `tilt=-6` (clamped -10..10), `priority`, `alt=''`, className | `/brand/softy-mark.png` with the die-cut edge |
| `<MarkerCircle>` | `children`, `animate=true`, className | an inline wrapper with a red hand-drawn SVG loop round the content (aria-hidden) |
| `<PriceTag>` | `label?`, `children` (e.g. `<Money amount/>`), `marker?`, `tape?`, `tilt=2`, className | white card, label in Plex bold, amount in Lalezar |
| `<StepNumber>` | `n` (number) or `children`, `tone='red'\|'navy'\|'white'`, `size='sm'\|'md'\|'lg'` | numbered circle with a white ring, Lalezar digit in `<Ltr>` |
| `<PaperCard>` | `as` (div section article li aside figure form), `tone='white'\|'grid'\|'news'`, `tape='start'\|'end'`, className, rest | flat card for forms and data |

Admin pages keep using `@/components/admin/kit` (same exports and props, restyled): AdminPageHeader (h1 = one navy scrap), Panel, StatTile (squared paper, Lalezar value), TableFrame/tableCls, StatusPill, Pill, EmptyState, btn, segment, field, InfoStrip.

The shell (`src/components/shell`): `Header` (white scrap with torn bottom, sticky), `Footer` (navy scrap), `NavLink`, `CtaLink` (a `ctaCls('md')` link with the left-pointing arrow), `InstallPrompt` (white paper card with tape and a CTA).

## 5. Where the collage goes and where it does not

**Collage (scraps, tilt, display fonts):** page heroes, section headings (h2), the main CTA of a view, prices and totals (marker), step numbers, tags and badges, empty states, the header, the footer, admin page titles, admin stat tiles.
**Flat (no tilt, no torn edge, Plex font):** forms, inputs, selects, checkboxes, tables, the builder's controls (radio cards, quantity box, size inputs), preview frames, admin data, dialogs, error and status boxes, long text.

Heading tiers:
- **h1 of a public page** = `ScrapHeadline` (5 scraps at most; size `xl` for heroes, `md`/`lg` on small pages). The home page keeps its `sr-only` h1 plus the decorative step cards.
- **h1 of an admin, staff or team page** = one navy scrap (AdminPageHeader, SectionTitle). Not split.
- **h2 that titles a page section or the builder step** = `SectionTitle` (one navy scrap).
- **h2/h3 inside a card, footer columns, sub-headings** = plain Plex bold (`text-lg font-bold text-ink`). Footer column titles are Lalezar on navy.

## 6. Rules (from Col-Rules, translated)

1. **One red word per view**, on its own scrap: in a ScrapHeadline. Besides it, red is allowed only for the main CTA, the marker round one price or detail, red step numbers and error text. Builder step titles and every SectionTitle are navy (`red='none'`).
2. **5 to 6 collage pieces per view at most.** Decorations are `aria-hidden`, `pointer-events-none`, mostly `hidden md:block`.
3. **Text always sits on a scrap or a card, never directly on a pattern** (news lines, grid, halftone). The plain paper ground with its grain is fine for body text.
4. **Tilt:** scraps and tags -3deg to 3deg (`TILT` or the `tilt` prop); stickers and small decorations up to ±10deg. Never tilt inputs, tables, cards that hold forms, or text blocks longer than one line. Anything wider than about 300px: at most 1.5deg.
5. **Tape on corners only.** No white text on orange: tape text is navy.
6. **Lime only for discounts.** The logo gradient only inside a cut circle. Purple `#8A2B8F` is retired outside the gradient.
7. **Full logo** (`softy-logo.png`) only on a clean white or navy scrap. The mark (`softy-mark.png`) is used as a sticker (`StickerMark`).
8. **Western digits 0-9** always, in `<Ltr>`, `<Money>` or `fillLtr`, including inside Lalezar.
9. **Square corners everywhere.** Use `rounded-[2px]` or the tokens. For circles write `rounded-[50%]` (kit rule: the token `rounded-full` is pinned by a test as "the circle result", see §9); the existing `rounded-full` on circle design previews (AiResult, TeamResult) stays.
10. **Never put `bg-*` on a `scrap` element** (it paints a rectangle round the torn edge). Never put Tailwind filter utilities (`brightness-*`, `drop-shadow-*`, `blur-*`) on a scrap or sticker: they replace its shadow. For hover, change `rotate` or `translate`.
11. **No `filter`, `transform`, `rotate` or `scale` on an ancestor of a `position: fixed` element** (the WhatsApp float, InstallPrompt, dialogs): it turns the ancestor into the containing block and moves the fixed element. A `scrap` uses `filter`, so a scrap never contains a fixed element. A section with sticky content uses `overflow-x-clip`, never `overflow-hidden`.
12. **No horizontal scroll at 390px.** A section with tilted or decorative pieces gets `overflow-x-clip`; `body` also has `overflow-x: clip` as a safety net, so look for overflow with the snippet in §10, not only by scrolling.
13. **The shadcn `Button` merges classes** (its `cn` drops the conflicting default `text-sm`, `h-8`, `px-2.5`, `rounded-lg`, `bg-primary`), so `<Button className={ctaCls('lg')}>` renders as the CTA scrap. One leftover: the Button keeps `text-primary-foreground`, so a CTA made with `<Button>` has cream (`#FDFBFA`) text instead of pure white on the red scrap (still AA). `CtaLink` callers may pass a smaller `text-*` (how-it-works uses `text-base`).

## 7. Old literal colours → tokens

| Old | New |
|---|---|
| `#121f34` | `ink` (`text-ink`, `bg-ink`, `border-ink`) |
| `#fdfbfa` | `paper` |
| `#d01c4a` | `brand` |
| `#b8163f` | `brand-ink` |
| `#5a6475` | `ink-muted` |
| `#e7dfdf` | `line` (or drop the border; the card has `shadow-paper`) |
| `#f7f0ef`, `#eef0f4` | `news` |
| `#ffeaed` / `#f3c4cf` | `brand-tint` / `border-brand-ink/30` |
| `#8a2b8f`, `#f4e8f5`, `#6b2170` | retired: `ink` / `news` |
| `#9aa3b5` | `ink/40` |
| `#1b2b46` | `ink-hover` |
| `#2a3a55` | `paper/25` |
| WhatsApp `#25d366` `#20bd5a` `#052e16` `#0b5a2e`; success `#15803d` | keep (WhatsApp and success only) |
| SVG sheet internals: `#fff`, `#000`, `#94a3b8`, `#e2e8f0`, `#cbd5e1`, checkerboards | keep: they draw the sheet |
| `bg-background` used as a card | `paper-card` |
| `glass` | `paper-card` (or `PaperCard`) |
| `rounded-full` pill badges | `Tag` / square `rounded-[2px]` |

## 8. Accessibility

- **Contrast is AA** (4.5:1; 3:1 for 24px+, or 18.66px+ bold). Pairs that pass: ink on ground 13.6; ink-muted on ground 6.4; ink-soft on ground 7.7; white on red 5.3; navy on tape 8.5; paper on navy 16; brand-ink on white 6.5 and on ground 5.2. **Red `#D01C4A` on the ground is only 4.25: red text under 24px never sits directly on the ground**; use `text-brand-ink`, or put it on white or news.
- **Focus is always visible.** shadcn parts: an unlayered rule (`[data-slot]:focus-visible`) makes their ring full-strength red. Scraps and CTAs: 3px navy outline, offset 3px (red on navy scraps). Custom controls: `focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink` (`outline-paper` on navy). Never `outline-none` without a replacement, except programmatic-focus headings that already have it (the builder h2, TextReview h3, TeamDesigner h2). Elements with `transition-colors` fade the outline colour in over 150ms.
- **Touch targets are at least 44px** (`min-h-11`, `size-11`).
- **Display fonts never for body text.** Plex for anything longer than about 4 words, except the existing hero strings.
- **Decorations** are `aria-hidden`; StickerMark has `alt=""` unless it is the only content of a link (then the link keeps its `aria-label`).
- **Reduced motion:** the collage animations and the CTA transition are off.

## 9. Do not break (tests select on these)

- Every visible string comes from `src/content/ar` (frozen). Split strings only visually (ScrapHeadline); `textContent` must equal the original.
- Keep every `id`, `data-*`, `aria-*`, `role`, `name`, `htmlFor` and `tabIndex`, element types (h1/h2/h3/li/aside/label/fieldset/dl), and the order of headings. Add no new `aside`, `li`, `h1`-`h3`, `role="status"`/`role="alert"`, `tabindex` or `alt=""` inside builder steps.
- The home page has exactly one h1: `builder.hero.flow.join(' ← ')`.
- `AdminPageHeader`: the StatusPill stays inside `h1.parentElement`.
- `<p role="status" class="sr-only">` (DesignStep, DetailsStep `#submit-status`): keep those class strings exactly.
- TeamDesigner render: no `rounded-full` in a rectangle result, no `left`/`right` word in any class (this includes SizeFields, TextReview, AiProgress); `<h2 id="team-shape"`: `id` stays the first prop, before `className`. AiProgress: no `left`/`right` anywhere, and the `style="width:N%"` stays.
- `team/login`: the outer div's class starts `flex min-h-[60vh]` and keeps `px-4`.
- Material cards: `label` wraps `input[name=material]`. `#qty-result`, `#stickers-input`, `#size-width`, `#design-file`, `#ai-idea`, `li[data-card]`, `data-receipt-*`, `aside li`, `svg use`, `data-mark` all stay.
- Labels counted by tests (`>{cutOut}<`, `role="alert"` counts, `aria-pressed` counts): no duplicates.
- Do not touch: `Money`, `Ltr`, `fill-ltr` (pinned), `manifest.ts` (golden), `src/components/ui/*`, the SVG internals of the sheet previews.

## 10. Before you report

```
pnpm typecheck
pnpm lint:rtl
pnpm eslint <your files>
CI=1 pnpm vitest run tests/unit/components tests/unit/team tests/unit/pages tests/unit/admin
```
The full `CI=1 pnpm check` runs once at the end. Look at your pages at 390px and 1280px (`pnpm dev -p <free port>`, never 3000). Check for overflow with:
`[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+1||r.left<-1}).filter(e=>!e.closest('[aria-hidden="true"]'))`
It must return nothing. Tab through every control and check the focus is visible. Never use the words left or right in a class or style; use logical utilities.
