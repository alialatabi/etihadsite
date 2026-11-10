# مطبعة سوفتي (Softy Printing) — project rules for every agent

Arabic-only (RTL, Iraqi dialect) A4 sticker-ordering site for a print shop in Iraq. Next.js 16 App Router, TypeScript, Tailwind v4, shadcn/ui (base-nova, RTL), pnpm. **Local development only for now — no Vercel deploy.** Windows machine.

## Read first
- `docs/PLAN.md` — the approved product plan. §2 layout rules, §3 design normalisation, §4 PDF, §5 order flow, §6 offers, §7 UI, §9 agent scopes.
- `src/lib/types.ts` — **the contract**. Frozen. Code against it; never edit it. If you must deviate, say so in your final report.
- `docs/STACK_NOTES.md` — Next 16 / Tailwind v4 / pdfjs / sharp gotchas.
- `AGENTS.md` — Next.js is newer than your training data; read `node_modules/next/dist/docs/` for any API you are not sure about (`proxy.ts` not `middleware.ts`; `params`/`cookies()` are async; `cacheComponents` is OFF here).

## Frozen files (do not edit in Phase 1)
`src/lib/types.ts`, `src/lib/units.ts`, `src/config/defaults.ts`, `src/content/ar/{common,builder,governorates,index}.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `next.config.ts`, `vitest.config.ts`, `src/components/ui/*`, `src/components/Ltr.tsx`, `src/lib/__fixtures__/*`, `package.json` (adding a dependency is allowed only if essential — report it).

## Conventions
- **Units:** integer micrometres (`…Um`). Convert with `src/lib/units.ts`. Never float mm.
- **Copy:** every user-visible string comes from `src/content/ar/*` via `import { builder, common, fill } from '@/content/ar'`. No hard-coded Arabic or English in components.
- **Digits:** Western 0-9. Wrap numbers, units, file names, phone numbers, order ids in `<Ltr>` (`@/components/Ltr`).
- **Plurals:** `count(n, common.plural.sticker)` from `@/lib/plural` — never hard-code one form.
- **RTL:** logical utilities only (`ms- me- ps- pe- start- end- text-start text-end rounded-s rounded-e`). `pnpm lint:rtl` must pass. "Next" arrows point LEFT (`ArrowLeft`), "back" arrows RIGHT. Pass `dir="rtl"` to portal content (Dialog/Select).
- **Prices:** `formatIqd()` + `common.units.iqd`. Never show a fake price: null → «السعر يُحدد عند التأكيد».
- **Server code:** files that touch fs/sharp/pdf-lib start with `import 'server-only'`. Route handlers validate with zod and never trust client prices or URLs.
- **Components:** shadcn components from `@/components/ui/*` (base-ui based: check each file's props before use). `cn` from `cn`.
- **Package manager:** pnpm. In a fresh worktree run `pnpm install --offline` (falls back to network if needed).

## Gate before you report
```
pnpm typecheck && pnpm test && pnpm lint && pnpm lint:rtl
```
Do **not** run `pnpm build` (the orchestrator does at integration). `pnpm dev -p <free port>` is fine for manual checks.

## Report format
Files changed · how you verified · any contract deviation or dependency added · known gaps.
