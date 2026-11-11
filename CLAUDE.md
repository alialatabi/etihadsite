# مطبعة سوفتي (Softy Printing) — project rules for every agent

Arabic-only (RTL, Iraqi dialect) A4 sticker-ordering site for a print shop in Iraq. Next.js 16 App Router, TypeScript, Tailwind v4, shadcn/ui (base-nova, RTL), pnpm. **The site is LIVE** on Vercel with Supabase storage (`STORAGE=supabase`); local development stores files under `./data` (`STORAGE=local`). Deploy only when the owner asks. The owner is not a developer. Windows machine.

## Read first
- `docs/ARCHITECTURE.md` — how the code is organised, where each shared helper lives, how-tos, and the hard invariants (section 9).
- `src/lib/types.ts` — the shared contract: stored JSON shapes, `StorageAdapter`, API types. A shape change is a stored-data and API change: add fields as optional or with a default; never rename or remove one without the owner's decision.
- `docs/STACK_NOTES.md` — Next 16 / Tailwind v4 / pdfjs / sharp gotchas.
- `AGENTS.md` — Next.js is newer than your training data; read `node_modules/next/dist/docs/` for any API you are not sure about (`proxy.ts` not `middleware.ts`; `params`/`cookies()` are async; `cacheComponents` is OFF here).
- `docs/PLAN.md` is the original plan and is historical; only §2 layout rules, §3 design normalisation and §4 PDF still describe the code.

## Handle with care
- `supabase/migrations/*` — never edit a file that has been applied; add a new one.
- `src/content/ar/*` — visible text. Changing a string is a content change, not a refactor.
- `src/lib/layout/*`, `src/lib/__fixtures__/*`, `src/lib/pdf/build-sheet.ts` — they decide what gets printed; their output is pinned to the byte.
- `tests/unit/golden/**` — the behaviour oracle. A failing golden test means behaviour changed: fix the code. Update a snapshot only for a change the owner asked for, one file at a time.
- `src/components/ui/*` — generated shadcn code; leave it alone.
- Old-brand identifiers that are data (bucket `etihad`, cookie `ep_admin`, order prefix `EP-`, browser storage keys, env var names) — see `docs/ARCHITECTURE.md` section 9.
- `package.json` — adding a dependency is allowed only if essential; report it.

## Conventions
- **Units:** integer micrometres (`…Um`). Convert with `src/lib/units.ts`. Never float mm.
- **Copy:** every user-visible string comes from `src/content/ar/*` via `import { builder, common, fill } from '@/content/ar'`. No hard-coded Arabic or English in components.
- **Digits:** Western 0-9. Wrap numbers, units, file names, phone numbers, order ids in `<Ltr>` (`@/components/Ltr`); for values inside a sentence use `fillLtr` (`@/components/fill-ltr`), for amounts `<Money>` (`@/components/Money`).
- **Plurals:** `count(n, common.plural.sticker)` from `@/lib/plural` — never hard-code one form.
- **RTL:** logical utilities only (`ms- me- ps- pe- start- end- text-start text-end rounded-s rounded-e`). `pnpm lint:rtl` must pass. "Next" arrows point LEFT (`ArrowLeft`), "back" arrows RIGHT. Pass `dir="rtl"` to portal content (Dialog/Select).
- **Prices:** `formatIqd()` + `common.units.iqd`. Never show a fake price: null → «السعر يُحدد عند التأكيد».
- **Server code:** files that touch fs/sharp/pdf-lib or secrets start with `import 'server-only'`. Exceptions: `src/lib/storage/local.ts` and the files it loads at runtime (no `server-only`, relative imports only, because `scripts/purge-orders.ts` runs them under tsx), and `src/lib/auth/token.ts`, which `src/proxy.ts` imports (see `docs/ARCHITECTURE.md` section 4). `src/proxy.ts` and route handlers are server code by nature and carry no marker. Route handlers validate with zod and never trust client prices or URLs. Every admin page behind the login and every admin action that changes data starts with `await requireAdmin()`; every admin route handler starts with `adminApiGuard()`.
- **Components:** shadcn components from `@/components/ui/*` (base-ui based: check each file's props before use). `cn` from `@/lib/utils`.
- **Package manager:** pnpm. In a fresh worktree run `pnpm install --offline` (falls back to network if needed). `pnpm purge` is a pnpm built-in that deletes `node_modules`; the retention script is `pnpm purge:orders`.

## Gate before you report
```
pnpm check
```
It runs `pnpm typecheck && pnpm test && pnpm lint && pnpm lint:rtl`. Set `CI=1` so a missing snapshot fails instead of being written. Run `pnpm build` before any deploy. `pnpm dev -p <free port>` is fine for manual checks; a dev server on port 3000 may be the owner's — leave it running.

## Report format
Files changed · how you verified · any contract deviation or dependency added · known gaps.
