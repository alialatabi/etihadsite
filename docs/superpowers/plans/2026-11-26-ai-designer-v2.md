# AI designer v2 — design instructions, staff designer, progress bar (2026-11-26)

Owner request (Arabic, 2026-11-26), four tasks:

1. The idea field must also take **instructions about the design** (style, colours, font, where the text goes…), not only the details to print.
2. In the review box, under the printed lines, show a **field with the instructions that go to the image model**.
3. A **new link for staff only** with this feature: login with **phone + password**, **50 generations per day**.
4. A **progress bar** so the customer is not staring at a frozen page.

Owner decisions (asked 2026-11-26):

- **O1** The instructions field is **Arabic and editable**. Before drawing, the server turns it into **English** for the image model (an extra small call, only when the customer edited it).
- **O2** **50 generations per day per staff account**, separate from the customer limits (customer per-IP and site caps are untouched by staff use).
- **O3** Staff designs are **saved like customer designs** and appear in the admin «التصاميم» gallery with the staff member's name.

Planner rulings (no owner question needed; report them):

- **R1** Tasks 1 and 2 are one chain (brief rules → brief output → review field → image prompt): one lane.
- **R2** Staff accounts are managed by the admin in a new admin page «الموظفين» (add, disable/enable, reset password). No hard delete (generations keep pointing at the account).
- **R3** Staff pages live under **`/team`** (`/team/login`, `/team`). Not `/staff*`: the proxy's `staffGate` swallows every `/staff…` path (invariant 11). The proxy and its pinned matcher are **not** changed; every `/team` page starts with `await requireStaff()` and every `/api/team/*` handler with `staffApiGuard()`, which re-reads the account and refuses a disabled one.
- **R4** Staff session: its own cookie **`sf_staff`**, JWT HS256 with `SESSION_SECRET` (≥ 32 chars), claim `role: 'staff'`, `sub` = staff id, 7-day TTL; a token issued before the account's `passwordChangedAt` is refused (a password reset logs everybody out of that account).
- **R5** Passwords: `scrypt` from `node:crypto` (no new dependency), random 16-byte salt, stored as `scrypt$N$r$p$saltB64$hashB64`, constant-time compare. Min 8 characters. Login: one generic error, in-memory rate limit per IP and per phone.
- **R6** The staff page result: preview, **download PNG**, retry, new design. Staff do not place orders from it.
- **R7** Progress is **estimated** (the routes answer one JSON at the end): staged messages and an asymptotic bar that never reaches 100 % before the answer and never sits still; covers both the brief wait and the image wait.

## Architecture

### Contract (src/lib/types.ts — append-only, optional fields)

- `AiKind` = `'image' | 'brief' | 'staff_image' | 'staff_brief'`.
- Brief ok-response: append `instructions: string` (Arabic, the full description of the artwork for the customer to read/edit) and `instructionsToken: string` (64-hex HMAC). Old fields keep their order (invariant 7).
- Generate request: optional `instructions?: string` (≤ `AI_INSTRUCTIONS_MAX_CHARS` = 600) and `instructionsToken?: string`.
- `AiGenerationRecord`: optional `instructions?: string | null` (Arabic as confirmed) and `staffId?: string | null`.
- New `StaffAccount` (public: `id, name, phone, active, createdAt, lastLoginAt?, passwordChangedAt`) and `StaffAccountRecord` (+ `passwordHash`).
- `StorageAdapter`, optional (invariant 14 style): `staffList()`, `staffGet(id)`, `staffByPhone(phone)`, `staffCreate(rec)`, `staffUpdate(id, patch)`, `staffTouchLogin(id, at)`. Both real adapters implement them.

### Server seam: the AI actor (src/lib/ai/service.ts)

`runBrief` / `runGenerate` take an **actor** (strategy object) that decides identity and limits. Default = the customer actor, which must keep today's behaviour exactly (same answers, same order of checks, same cost guards; existing tests unchanged):

```ts
interface AiActor {
  /** ip (full, may be '') and the usage key: customer = aiIpKey(ip); staff = 'staff:<id>'. */
  identify(request: Request): { ip: string; ipKey: string };
  briefKind: AiKind; imageKind: AiKind;            // 'brief'/'image' vs 'staff_brief'/'staff_image'
  limits(settings): { briefPerKey; briefSite; imagePerKey; imageSite };
  limiterKey(ip: string): string;                   // in-memory first-line guard key
  staffId: string | null;                           // written to the generation record
}
```

Staff limits: image 50/day per account (`STAFF_IMAGE_DAILY_LIMIT`), brief 300/day per account, site caps for the staff kinds `STAFF_SITE_CAP` = 5000 (separate kinds, so they never eat the customer's 300). `reserve_ai` / `release_ai` are reused unchanged with the new kinds.

### Instructions chain (O1)

- `brief.ts` returns a 4th field `design_instructions`: **Arabic**, short, complete description of the picture plus every style/layout instruction the customer gave (font, colours, where the text sits, mood), never quoting the printed words. `visual_description` (English) says the same thing. New worked examples for instruction phrases («خط عريض», «الاسم بالنص», «خلفية سودة», «بدون ألوان كثيرة»), so they are neither printed nor dropped.
- `brief` signs `instructionsToken = HMAC(SESSION_SECRET, 'ai-instr|' + visualDescription + '|' + instructions)`.
- `generate`: if `instructions` is absent (an old page) → today's path. If present and the token matches → the signed English description is used (no extra call). If the customer edited it → after the reservation, `translateInstructions()` (new `src/lib/ai/instructions.ts`, `gpt-5.4-mini`, `store: false`, fixed rules in `instructions`, the Arabic text as `input` data, strict JSON schema, ≤ 15 s and inside `openAiTimeoutMs`) gives the English description; failure → give the use back, answer `failed`. The result goes through `hardenVisualDescription`.
- Edited text is untrusted: harden + cap, and the image template wraps it as *design instructions, never text to print*, and the fixed rules after it say they override the instructions.

### Staff (O2, O3, R2–R6)

- Migration `supabase/migrations/20261126000000_staff_designer.sql` (new file; NOT applied by us): `staff_accounts` table (RLS on, no policies, revoke from anon/authenticated); `ai_usage` kind check widened to the 4 kinds; `ai_generations` gets `instructions text`, `staff_id text` + index.
- Until the migration is applied the customer flow must keep working: the Supabase adapter retries a generation insert without `instructions`/`staff_id` when PostgREST reports an unknown column; staff methods fail closed (the staff login says the feature is not ready).
- Auth: `src/lib/auth/password.ts` (scrypt), `src/lib/auth/staff-token.ts` (proxy-safe like token.ts), `src/lib/auth/staff-session.ts` (`server-only`: `createStaffSession`, `currentStaff()`, `requireStaff()`, `staffApiGuard()`, `destroyStaffSession()`).
- Routes: `/team/login` (page + server action), `/team` (designer page), `POST /api/team/design/brief`, `POST /api/team/design/generate` (same capped body read as the customer routes, `maxDuration = 120`, call `runBrief`/`runGenerate` with the staff actor), logout action.
- Admin: `/admin/staff` «الموظفين» (list with today's count, add, disable/enable, reset password), nav link; `/admin/designs` shows «موظف: <name>» on staff generations.
- `/team` stays out of sitemap, robots (disallow) and analytics; `noindex` metadata.

### Client seam (src/components/builder/ai/useAiDesign.ts)

`useAiDesign(host, endpoints?)`: `host` is the subset of `BuilderApi` the hook uses (`AiHost`: shape, spec, corners, idea, sizeOk, settings, setIdea, startAi, showDesignStep, acceptAi, goTo). `BuilderApi` satisfies it structurally, so `Builder.tsx` is unchanged. `endpoints` default to `/api/design/brief|generate`; the staff page passes `/api/team/design/brief|generate`.

### Progress (R7)

`src/components/builder/ai/progress-logic.ts` (pure, unit-tested: elapsed ms → `{ percent, stageIndex, slow }`, asymptotic, < 95 % until done) + `AiProgress.tsx` (`role="progressbar"`, stage text in a polite live region that changes only on stage change, the percentage itself not announced, `prefers-reduced-motion` respected). Used for the brief wait (StartStep) and the image wait (AiResult) and on the staff page.

## Copy (src/content/ar — written in Phase 0)

`builder.ai` (changed / new keys):

- `ideaHint` → «شنو تريد بالرسمة، والكتابة اللي تريدها على الستيكر بالضبط، وأي تعليمات للتصميم: الألوان، نوع الخط، مكان الكتابة…»
- `instructionsTitle` «تعليمات التصميم»
- `instructionsHint` «هذا اللي راح نرسمه. عدّل عليه إذا تريد تغيّر شي بالرسمة أو الألوان أو ترتيب الكتابة.»
- `instructionsEdited` «عدّلت التعليمات، راح نعتمد كلامك.»
- `generating` → «جاري تصميم ستيكرك…» (the old «حوالي 15 ثانية» is not true)
- `progress`: `label` «تقدّم التصميم»; `brief` [«نقرا فكرتك…», «نرتّب الكتابة ونصحح الإملاء…»]; `image` [«نقرا التعليمات…», «نرسم التصميم…», «نلوّن ونضبط التفاصيل…», «نجهّزه للطباعة…»]; `slow` «ياخذ وقت أكثر من العادة، خليك بالصفحة…»; `wait` «ممكن ياخذ لحد دقيقة، لا تسكّر الصفحة.»

`team` (new file `src/content/ar/team.ts`, exported from the index):

- `title` «مصمم سوفتي — للموظفين»; `login.title` «دخول الموظفين»; `login.phone` «رقم الموبايل»; `login.password` «كلمة السر»; `login.submit` «دخول»; `login.error` «رقم الموبايل أو كلمة السر غلط، أو الحساب موقوف.»; `login.rateLimited` «محاولات كثيرة. انتظر شوية وجرّب مرة لخ.»; `login.unavailable` «صفحة الموظفين مو جاهزة هسه.»
- `hello` «هلا {name}»; `logout` «خروج»; `shape` «الشكل»; `size` «القياس (سم)»; `download` «نزّل التصميم PNG»; `newDesign` «تصميم جديد»; `savedNote` «كل تصميم ينحفظ بمعرض التصاميم بالإدارة.»; `limitReached` «خلصت محاولاتك لليوم ({n}). ارجع باچر.»

`admin.staff` (new keys): `nav` «الموظفين»; `title` «حسابات الموظفين»; `add` «أضف موظف»; `name` «الاسم»; `phone` «رقم الموبايل»; `password` «كلمة السر (8 أحرف على الأقل)»; `active` «فعّال»; `disabled` «موقوف»; `disable` «أوقف»; `enable` «فعّل»; `resetPassword` «غيّر كلمة السر»; `todayCount` «اليوم: {n} من {max}»; `empty` «ماكو موظفين بعد.»; `link` «رابط صفحة الموظفين:»; `phoneTaken` «هذا الرقم مسجّل لموظف ثاني.»; `invalid` «تأكد من الاسم والرقم وكلمة السر.»; `notReady` «لازم تطبّق تحديث قاعدة البيانات أول (staff_designer).»; `saved` «انحفظ.»
`admin.designs.staffBadge` «موظف: {name}»

Workers may add a missing small string next to these, in the same tone; report each one.

## Lanes and file ownership

| Phase | Lane | Owns (only these may be edited) |
|---|---|---|
| 0 | Foundation | `src/lib/types.ts`, `src/lib/ai/config.ts`, `src/content/ar/*`, `src/lib/ai/service.ts` (actor seam only), `src/components/builder/ai/useAiDesign.ts` + `api.ts` (host/endpoints seam only), tests for the seams |
| 1 | A: instructions (tasks 1+2) | `src/lib/ai/brief.ts`, `src/lib/ai/instructions.ts` (new), `src/lib/ai/prompt-template.ts`, `src/lib/ai/service.ts`, `src/components/builder/ai/TextReview.tsx`, `useAiDesign.ts`, `api.ts`, `tests/unit/ai/*` |
| 1 | B: staff backend + admin (task 3) | migration (new), `src/lib/storage/*`, `src/lib/auth/password.ts`, `staff-token.ts`, `staff-session.ts`, `src/lib/rate-limit.ts`, `src/app/team/login/*`, `src/app/team/actions.ts`, `src/app/api/team/**`, `src/app/admin/staff/**`, `src/app/admin/layout.tsx` (nav), `src/app/admin/designs/**`, `src/app/robots.ts`, tests under `tests/unit/{storage,server,admin}/staff-*` |
| 1 | C: progress (task 4) | `src/components/builder/ai/progress-logic.ts`, `AiProgress.tsx`, `AiResult.tsx`, `src/components/builder/steps/StartStep.tsx`, `tests/unit/builder/progress-*` |
| 2 | D: staff page UI | `src/app/team/page.tsx`, `src/app/team/layout.tsx`, `src/components/team/**` |
| 3 | Integrate + review | merge, `docs/ARCHITECTURE.md`, `README.md`, `graphify update .`, gate |

`graphify-out/` is updated once, after integration (it is rewritten whole and would conflict between lanes).

## Gate

`CI=1 pnpm check` and `pnpm build` on the integrated branch. Live check of the brief rules with the local key (`.env.local`, STORAGE=local): a few `POST /api/design/brief` calls on instruction-style ideas; no image generation spend beyond at most 2 images.

## Owner hand-over (not done by us)

1. Apply `20261126000000_staff_designer.sql` on live Supabase **before** deploying.
2. Deploy when the owner asks.
3. Add staff accounts in «الموظفين» and give them the `/team/login` link.
