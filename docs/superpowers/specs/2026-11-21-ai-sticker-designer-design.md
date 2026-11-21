# In-site AI sticker designer: design

Date: 2026-11-21 · Status: draft for owner approval · Site: «مطبعة سوفتي» (live)

## 1. Intent

The owner wants customers to design their sticker **inside the site** instead of being told
«ما عندك تصميم؟ نصمملك» and sent to WhatsApp. The customer chooses a shape and a size, types
their idea in one field (optionally with up to 5 reference images), and the site generates the
artwork with OpenAI's newest image model. The generated design becomes the order's design and
goes through the **existing** A4 arrangement, quantity, details and submit flow unchanged.

Every customer message goes through a **fixed prompt template** so the shop's design rules always
apply and the results look good and print well.

### Goals
- Remove every «we design it for you» prompt and leave **one** WhatsApp contact button.
- An in-site generator with the shop's rules enforced by a server-side template.
- Correct Arabic spelling on the printed text; text never smaller than 12 pt (Word sense).
- Hard daily limits (5 per customer IP, 300 site-wide), an admin page with counters, a gallery of
  every generated design, alerts for IPs that hit the limit, and IP blocking.
- The existing upload path stays available behind «عندي تصميم جاهز».

### Non-goals
- Editing a generated design inside the site (no canvas editor, no text-moving tools).
- Vector output or automatic cut contours. Custom shapes are still cut by the camera cutter reading
  the printed paper; the template only adds a printed white border.
- Charging for generations, accounts or logins for customers.
- Animated output (the model can do GIFs; stickers can't).

### Anti-goals (a failure even if it "works")
- The OpenAI key reachable from the browser, or any route that calls OpenAI without the limits.
- A bill that can grow without a ceiling.
- A misspelled or illegibly small word printed on a customer's sticker without them seeing it first.
- The order, PDF or staff-sheet output changing for uploaded designs (those files are pinned to the byte).
- An IP address in analytics events or sent to Sentry (the AI tables may hold it, D9).

## 2. Owner decisions (from the conversation, 2026-11-21)

| # | Decision |
|---|---|
| D1 | Remove all «ما عندك تصميم؟ نصمملك» prompts. The single remaining contact button is the **floating «استفسار» button** (owner chose it over the header icon). |
| D2 | After a design the customer likes, the order continues with the existing rules: arranged on the A4 sheet, the customer may change the size there, then quantity, details, submit. |
| D3 | First page, in this order: shape → size → one free-text field for the idea and every detail (+ up to 5 reference images) → generate. Under it a button «عندي تصميم جاهز» that leads to the existing upload. |
| D4 | Template rules: fix the spelling of the customer's text; text never below 12 pt (font size as in Word, ≈ 4.23 mm em, ≈ 3 mm body of a normal letter); avoid very dark colours and black/near-black gradients; **bleed (white border) only for custom die-cut**, none for circle/square/rect. |
| D5 | Limits: **5 generations per IP per day**, **300 per day site-wide**. |
| D6 | Admin: counter of generated designs, the designs themselves, an alert when an IP reaches 5 in a day, and a button to block that IP. |
| D7 | The "review the text" box (approved): before generating, the customer sees the corrected text lines, can edit/delete/add, and is warned (and blocked) when the text is too much for the chosen size. |
| D8 | Model: **`gpt-image-2.6-flare`**, **1024 px** on the long side. |
| D9 | **The full IP is stored** (owner's explicit decision, overriding the "never store the IP" rule of ARCHITECTURE §5 for the new AI tables only; analytics events still never carry an IP — invariant 8 unchanged). Stored in the AI tables next to a keyed hash used as the limit/block key. |
| D10 | **Designs are never deleted**: every generated design (ordered or not) and the design file + order record of **every** order (uploaded or generated) are kept forever, so a future "order again" feature can reuse them. Only the print-sheet PDF keeps the `retentionDays` purge (it can be rebuilt). Uploads that never became an order are still purged as today. |
| D11 | The sentence promising deletion of design files is **removed from the site** (`builder.details.consent` first sentence, `common.filesNotice` first sentence); the rest of those texts stays. |
| D12 | No bot check (no Turnstile) on generation for now; the 5/IP and 300/site limits are the guard. |
| D13 | Approved 2026-11-21: "اي موافق بلش ببناء الكود". |

## 3. Evidence from the spike (2026-11-21, throwaway, 14 images)

Images: `Claude outputs/ai-sticker-test/`. Scripts: session scratchpad (not in the repo).

- The account has `gpt-image-2.6-flare` and `gpt-image-2.6-sunburst` (also 2.5, 2, 1.5, mini).
- **Arabic text rendered correctly in all 14 images**: hamza and tanween (أهلاً وسهلاً), گ چ پ,
  phone numbers, Eastern digits, multi-line text. The model wrote exactly the lines it was given.
- **Flare ≈ 11–18 s, Sunburst ≈ 30 s** per call; quality difference small.
- Cost (third-party price lists, not verified on the account): ≈ $0.053 per 1024² high-quality image
  (1,756 output tokens at $30/1M); reference images add ≈ $0.016 for two inputs. Worst case
  300/day ≈ $16/day.
- `background: "transparent"` works for custom (white border + transparent outside). With no
  `background` the model may return a circle with transparent corners on its own. With
  `background: "opaque"` and "fill the whole square" the model put text and elements too close to
  the circle edge (phone number would be clipped). **→ For circles, ask for a round sticker with
  transparent outside, then flatten onto white server-side** (spike #1 shape, 21 % transparent =
  exactly the area outside the inscribed circle).
- PNG alpha came back at **253–254 for "opaque" pixels, never 255**, and fully transparent pixels
  carry dark RGB. The site's decode treats any alpha < 255 as "has alpha" → must be normalised (§5.4).
- `/v1/images/edits` with 2 reference images (`image[]`) + `background: transparent` worked and kept
  the character recognisable.
- Sizes: any width/height divisible by 16 was accepted for 2048×2048; the error for 9999 was about
  divisibility, so the maximum is unknown (irrelevant at 1024).
- **The text-extraction step is the weak point.** `gpt-5.4-mini` with a JSON schema fixed spelling
  well (اسمة→اسمه, اهلا→أهلاً, kept phone numbers), but in one case it took the customer's description
  of the artwork («جوه منها چاي…», «بي كوب چاي عراقي…») as text to print. → D7 review box + a better
  extractor prompt with examples.
- **The model ignores "letters at least N % tall" when there is a lot of text** (6 lines on 3 cm →
  ≈ 2 mm letters). → the text-capacity check (§5.3) is the real guard; the prompt hint is secondary.

## 4. Approaches considered

| | Approach | Trade-off | Verdict |
|---|---|---|---|
| A | **Synchronous generation in a Vercel function** (route calls OpenAI, normalises, stores, answers) | Simple; key and limits stay server-side; Flare (~11–18 s) fits a 60 s `maxDuration` | **Chosen** |
| B | Background job (queue/workflow) + polling | Survives slow models; needless moving parts for an 11–18 s call | Rejected |
| C | Browser calls OpenAI directly | Exposes the key; limits unenforceable | Rejected |

Text rendering: the spike showed the model writes Arabic correctly, so **the model draws the text**.
The fallback (model draws artwork only, the site typesets the text with a real Arabic font) is
not built; it stays available if quality regresses.

## 5. Design

### 5.1 WhatsApp cleanup (D1)

| Touchpoint | Action |
|---|---|
| Header icon (`Header.tsx:14,33-43`) | **Remove** |
| Footer contact link (`Footer.tsx:13,44-51`) | **Remove** |
| Floating «استفسار» (`Builder.tsx:108,157-172`) | **Keep** — the single contact button |
| Home hero «ما عندك تصميم؟ نصمملك» (`page.tsx:90,105-109`) | Remove |
| ShapeStep noDesign card + «عندي ملف جاهز» link (`ShapeStep.tsx:19-20,84-98`) | Remove |
| DesignStep noDesign card + «تحتاج تعديل؟» (`DesignStep.tsx:29-30,135-143`) | Remove |
| How-it-works card (`how-it-works/page.tsx:59,135-137`) | Remove |
| Success-page WhatsApp (order confirmation), degraded fallback, no-materials fallback | **Keep** (part of ordering, not "contact") |

Copy keys that become unused are deleted (`builder.noDesign.*`, `builder.whatsappText.noDesign/
readyFile/editDesign`, `builder.shape.readyFileLink`, `pages.howItWorks.noDesign*`,
`pages.shell.whatsappAria`, and `common.nav.whatsapp` if nothing else uses it). The floating button
is shown wherever the builder is today (home page); the owner chose it knowing it is home-only.

### 5.2 Builder flow

**Keep the five step ids** (`shape, design, size, quantity, details` in `types.ts:591`) — they are
data for analytics, the admin funnel, draft restore and golden tests. Change what they render:

| Step id | Stepper label (new copy, owner reviews) | Renders |
|---|---|---|
| `shape` | «صمّم» | **New first page**: 1) shape cards (+ corners for rect), 2) size inputs (moved here from SizeStep; same `safeDerive`/limits), 3) the idea textarea + up to 5 reference images, 4) «ولّد التصميم» which first runs the text review box (D7). Under all of it: «عندي تصميم جاهز». |
| `design` | «التصميم» | **AI mode**: generation progress, then the result with «أكمل بهذا» / «جرّب مرة لخ» (shows remaining tries today) / «عدّل الفكرة» (back). Shows «الكتابة: …» under the image. **Upload mode** (via «عندي تصميم جاهز»): today's DesignStep upload UI unchanged. |
| `size` | «الترتيب» | Today's SizeStep (size inputs, DPI, layout errors) + the A4 arrangement preview; the customer may change the size here (D2). If the size goes **below** the generated size, show a warning that text may become too small (not blocked). |
| `quantity` | unchanged | unchanged |
| `details` | unchanged | unchanged |

- `stepOk.shape` = shape chosen **and**, in AI mode, a valid size. In upload mode («عندي تصميم
  جاهز») the size on the first page is optional and the uploaded file decides it exactly as today
  (aspect re-derive, PDF prefill); the customer sets it on the `size` step. *(Builder-check call.)*
  `stepOk.design` = a design accepted (AI) or decoded (upload). The rest unchanged.
- **Meaning of the typed size in AI mode** *(builder-check call)*: circle → diameter; rect → width ×
  height chosen freely before any design (the request is built from that ratio); custom → a
  **square box**: the generated subject is fitted inside it, so after acceptance the **longer side
  of the trimmed design keeps the typed size** and the shorter side follows the subject. The text
  capacity check (§5.3) for custom uses 80 % of the box, which stays conservative because the
  template asks the subject to fill the canvas. If, after acceptance, the real sticker is smaller
  than the size the text check used, the size step shows the same "text may be too small" warning.
- Accepting a generated design wraps the PNG as a `File` and calls the existing `b.onFile(file)`, so
  decode, preview, IndexedDB draft, restore and submit work as today. The aspect lock comes from the
  generated image; for circle/square it is 1, so the size the customer chose is kept.
- To avoid uploading the generated PNG a second time at submit, the submit context is seeded with
  the generated `uploadId` (`useSubmitOrder.ts:35` / `submitFlow.ts:86-89`).
- The idea text and the AI/upload mode are added to the persisted draft as **optional** fields
  (`ub:draft:v1` stays). Reference images and un-accepted results are not persisted.
- If the AI feature is unavailable (no key, `ai.enabled=false`, site cap reached, IP blocked) the
  first page still shows shape + size, the idea field is replaced by a short notice, and
  «عندي تصميم جاهز» remains — ordering is never blocked.
- Home hero text (`builder.hero.flow`, first item «ارفع تصميمك») and the how-it-works copy describe
  the old upload-first flow; they get new wording for the new flow (listed for owner review).

### 5.3 Text review box and the 12 pt rule (D4, D7)

1. «ولّد التصميم» → `POST /api/design/brief` → the extractor returns `printed_text[]` (spelling
   fixed) + `visual_description` (English) + `spelling_fixes[]`.
2. The box lists each line as an editable input (delete / add line), shows the fixes, and computes
   **text capacity** for the chosen shape and size:
   - 12 pt ⇒ em = 4.233 mm; line pitch = 1.5 em ≈ 6.35 mm; average Arabic glyph advance ≈ 0.55 em.
   - Usable text box: circle → inscribed square (0.70 d) minus 8 % margin; rect/square → 90 % of
     each side; custom → 80 % of each side.
   - Text may use at most **50 %** of the usable height (the rest is artwork).
   - A line of *n* characters needs `ceil(n × 0.55 × 4.233 mm / usableWidth)` rows.
   - If total rows × 6.35 mm > 50 % × usable height → **block** with «كتابتك كثيرة على قياس X سم —
     قلّلها أو كبّر القياس», naming the smallest size that would fit.
   - Example: 3 cm circle → usable ≈ 19 mm, budget ≈ 9.7 mm → 1 row of ≈ 8 characters.
   These constants are a starting point; the builder tunes them against the spike images and pins
   them in unit tests.
3. «ولّد» (confirm) → `POST /api/design/generate` with the confirmed lines.

### 5.4 Server

**Module layout** (all `import 'server-only'`): `src/lib/ai/` — `config.ts` (model ids
`gpt-image-2.6-flare`, `gpt-5.4-mini`; sizes; timeouts), `openai.ts` (plain `fetch`, no new
dependency; base URL injectable for tests), `brief.ts` (extractor prompt + JSON schema, with 3–4
worked examples including the café case from the spike), `prompt-template.ts` (pure function,
unit-tested), `normalise.ts`, `limits.ts`, `ip.ts`.

**Prompt template** (`prompt-template.ts`), built from: shape rules; final size in cm; the English
`visual_description`; reference-image instruction when refs exist; the exact confirmed lines
(numbered, «letter for letter, keep every space, hamza and tanween, no other text»); the minimum
text size as % of the shorter side; colours (bright, no very dark areas, no black/near-black
gradients); style (clean vector-like, bold shapes, no tiny details, no watermark/signature/frame,
not a mockup). The customer's text is passed as quoted data inside the template; instructions in it
cannot change the rules.

| Shape | Request | Shape rule |
|---|---|---|
| circle | 1024×1024, `background: transparent` | Round sticker = circle inscribed in the canvas, everything ≥ 8 % inside its edge, transparent outside. Server flattens onto white. |
| rect (sharp/rounded) | long side 1024, other side = 1024 × aspect rounded to a multiple of 16; `background: opaque` | Fill edge to edge; letters ≥ 5 % from edges; no border, no bleed. (Builder verifies non-standard sizes are accepted; fallback: nearest of 1024², 1536×1024, 1024×1536 then centre-crop.) |
| custom | 1024×1024, `background: transparent` | Die-cut: one continuous smooth thick white border (≈ 3 % of width) around the artwork = printed bleed; no holes, spikes or loose pieces. |

Quality `high` (≈ $0.053). With reference images: `/v1/images/edits`, `image[]` × ≤ 5.

**PNG normalisation** (`normalise.ts`, sharp) before storing:
- circle, rect: flatten onto white → opaque RGB PNG (then the site's normal path treats it as an
  opaque image; the circle clip in the PDF cuts the circle as today).
- custom: alpha ≥ 250 → 255; alpha ≤ 8 → 0 with RGB set to white; keep PNG with alpha. Verify that
  `decodeDesign` then trims to the subject and `no_alpha` cannot trigger.

**Routes** (zod-validated, never trusting the client):
- `POST /api/design/brief` — `{ idea ≤ 1000 chars, shape, widthUm, heightUm }`. Not counted toward
  the customer's 5, but capped by a **stored** daily counter in the same `ai_usage` table (a `kind`
  column: `brief` | `image`): 20 per IP and 1,500 site-wide per day (constants; each call costs a
  fraction of a cent). Plus the in-memory limiter as a first, cheap guard. *(Builder-check call.)*
  Returns `{ lines, fixes }`.
- `POST /api/design/generate` — `{ shape, corners, widthUm, heightUm, idea, lines[], refUploadIds ≤ 5 }`.
  Order of checks: feature enabled + key present → Turnstile when configured (existing
  `src/lib/turnstile.ts`) → IP blocked? → **atomic reserve** (per-IP and site) → OpenAI (timeout
  50 s; `maxDuration = 60`) → normalise → `storage.saveUpload(id, png, meta)` → record the generation
  → respond `{ uploadId, remainingToday, png (base64, ≈ 2 MB < 4.5 MB limit) }`. On an OpenAI error
  or a content-policy refusal, the reservation is released (failed tries don't count) and a
  friendly Arabic error is shown.
- Reference images go through the **existing direct-upload path** (`/api/upload/direct` + commit)
  and are referenced by `uploadId`; the generate route reads them with `storage.readUpload`.
  PNG/JPEG only.
- `POST /api/orders` (existing): when the order's `uploadId` belongs to a generation, mark that
  generation as ordered (best effort, never fails the order).

**Limits and storage** — new migration (new file; applied migrations untouched):
- `ai_usage(day date, ip_hash text, kind text, count int, last_at timestamptz, primary key(day, ip_hash, kind))`
  — also the source of the **all-time / monthly counters** on the admin page (kept 400 days), so the
  counters do not shrink when old designs are purged.
- `ai_generations(id text pk, created_at, day, ip_hash, ip_prefix, shape, corners, width_um,
  height_um, idea, lines jsonb, has_refs bool, model, upload_id, order_id null)`
- `ai_blocks(ip_hash pk, ip_prefix, created_at)`
- RPC `reserve_ai_generation(p_day, p_ip_hash, p_per_ip, p_site) returns text` ('ok' |
  'ip_limit' | 'site_limit' | 'blocked'), done in one transaction with row locks; `release_…`
  decrements. RLS on, no policies, revoke from anon/authenticated, execute for `service_role` only
  (same pattern as `patch_order`).
- `StorageAdapter` gains **optional** AI methods implemented by both adapters (Supabase via
  RPC/PostgREST; local via JSON files under the existing in-process lock, dev only).
- Day = `shopDayKey` (Asia/Baghdad). Site cap counts successful generations of that day.

**IP handling (D9)** — `clientIp()` (TRUST_PROXY hops; production = 1). The limit/block key is
`HMAC-SHA256(SESSION_SECRET, "ai-ip|" + ip)` (hex); the **full IP is also stored** in
`ai_generations.ip`, `ai_usage.ip` and `ai_blocks.ip` and shown in full in the admin page (owner
decision). If `clientIp` returns `"global"`
(TRUST_PROXY = 0, local dev) the per-IP limit is skipped and only the site cap applies. `ipOf()`
and `clientIp()` stay separate (invariant 9).

**Env** — `OPENAI_API_KEY` (server-only), read directly from `process.env` inside `src/lib/ai/`
(not added to `orderEnvSchema`, so a bad key can never break orders). Added to: `.env.example`,
the ARCHITECTURE §4 table, README env list, and the Sentry scrubber secret list
(`sentry.server.config.ts:17-23`). The key goes in `.env.local` locally and in Vercel env for
production; never in the repo.

**Settings** — `ShopSettings.ai = { enabled: true, perIpDailyLimit: 5, siteDailyLimit: 300 }`
appended after `retentionDays` (key order matters to the settings golden test); defaults in
`DEFAULT_SETTINGS`; schema with `int()` ranges; fields in the admin settings form.

### 5.5 Admin: «التصاميم» page (D6)

`/admin/designs` (`requireAdmin()` first; nav link added):
- **Counters**: today `x / 300`, this month, all time (from `ai_generations`).
- **Alerts**: IPs that reached the per-IP limit today (and yesterday), as `185.23.x.x — 5 تصاميم —
  10:42` with «عرض» (filters the gallery to that IP) and «احظر». A count badge on the nav link while
  there are unhandled alerts today.
- **Blocked list** with «إلغاء الحظر». Blocking stops generation only; that customer can still
  upload and order.
- **Gallery**: newest first, 48 per page: thumbnail, time, shape and size, the idea, the printed
  lines, a badge and link when it became an order.
- Images are served by a new `GET /api/admin/designs/[id]/image` (`adminApiGuard()` first) that
  streams the PNG inline from storage (no signed URL in the page).
- Block/unblock are server actions starting with `requireAdmin()`.

### 5.6 Retention (D10, D11)

- Generated PNGs are stored as `uploads/<id>.bin` + `.json` (full PNG, used by the order). The
  purge must **skip any upload referenced by an `ai_generations` row** and **any upload referenced
  by an order** (all orders are now kept).
- Orders: the purge **no longer deletes order records or design files**; it deletes only
  `orders/<id>.pdf` older than `retentionDays` (the admin "download PDF" link must handle a purged
  PDF gracefully, e.g. rebuild on demand or show «انحذف ملف الطباعة»).
- Unreferenced uploads (never ordered, not generated) are still deleted after `retentionDays`, and
  orphan `.bin` files without `.json` after 3 h, as today.
- `ai_generations` rows and `ai_blocks` are kept forever; `ai_usage` 400 days (counters).
- Storage growth: ≈ 1.5 MB per generated PNG. If it becomes a problem later, an archive copy can be
  compressed; not built now.
- `builder.details.consent` and `common.filesNotice` lose their first sentence (the deletion
  promise). The `retentionDays` settings label becomes about the print sheet (wording in the plan).
- ARCHITECTURE §5 retention table and §9 notes are updated to describe the new rules and D9.

### 5.7 Smaller calls settled after the builder check

- **Shared IPs (carrier NAT):** the owner was told that one mobile IP can be shared by many
  customers and kept the per-IP rule. No per-browser key is added. Blocking only stops generation,
  never ordering, which limits the damage of blocking a shared address.
- **Big stickers at 1024 px (D8):** the existing DPI warning (< 150 DPI) appears from ≈ 17 cm for a
  square design and ≈ 13 cm for a portrait rect or a trimmed custom subject; < 72 DPI blocks as
  today. Accepted with the owner's 1024 choice; no AI-specific size cap. The generation result
  screen shows the same DPI warning before «أكمل بهذا» when the chosen size triggers it.

## 6. Constraints the build must respect

- Pinned to the byte: `src/lib/layout/*`, fixtures, `build-sheet.ts`, `sheet-page.ts`,
  `build-staff-pdf.ts`. No change is planned there.
- Golden tests: update only for owner-asked changes, one file at a time: `copy.golden` (new and
  removed copy), `schemas-settings.golden` + `admin.golden` helper + `supabase-storage.golden`
  (the new `ai` settings key). `builder-logic.golden` STEPS stays unchanged (ids kept).
- Invariants (ARCHITECTURE §9): new migration only; bucket and `uploads/<id>.bin|json` paths
  reused; stored shapes only gain optional fields; API routes and bodies of existing endpoints
  unchanged; admin guards first; `server-only` on new server modules; no IP in stored events; the
  scrubber covers the new secret.
- Copy only from `src/content/ar/*`; RTL logical classes; `pnpm check` must pass with `CI=1`;
  `pnpm build` before any deploy. No new npm dependency (plain `fetch` to OpenAI).
- Deploy and the Supabase migration on production only when the owner says so.

## 7. Verification

- Unit: prompt template (per shape), text capacity (incl. the 3 cm example), PNG normalisation
  (alpha 253 → 255, dark RGB under alpha 0 → white, circle flatten), IP hash/prefix, reserve/release
  on the local adapter (5 / 300 / blocked / release on failure), brief and generate routes with a
  mocked OpenAI (errors, refusal, timeout, limits), admin actions.
- One live smoke run against OpenAI (Flare) per shape before deploy, eyeballed by the owner.
- e2e: the AI path with a mocked OpenAI base URL; the existing order-flow, draft-restore and
  validation specs updated for the new first page.

## 8. Left to the builder

Exact component split; the extractor's few-shot examples; capacity constants after tuning;
gallery pagination details; loading/progress UI; how the remaining-tries count is shown; e2e mock
mechanism; whether `brief` and `generate` share a module.

## 9. Still open (do not block the build)

1. New Arabic wording (stepper labels, first page, review box, errors, admin page, new hero and
   how-it-works text) will be listed in the plan for the owner to read before it ships.
2. Rotate the OpenAI key that was pasted in chat and set a monthly budget on the OpenAI account
   before deploy (recommended, not blocking the build).
