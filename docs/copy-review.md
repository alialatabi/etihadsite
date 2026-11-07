# مراجعة النصوص / Copy review

Scope: `src/content/ar/common.ts` and `builder.ts` (both frozen; the orchestrator applies what is accepted).
Reviewer lens: native Iraqi (Baghdad) copywriter. Format: key, current, proposed, why.
Priority: **P1** fix before launch, **P2** should fix, **P3** polish.

## 1. Numbers hard-coded in copy that the owner can change in admin settings (P1)

These strings state a value that lives in `ShopSettings`. If the owner edits the setting, the text lies.
Proposal: turn each into a `{placeholder}` filled with `fill()` (numbers inside `<Ltr>`).

| Key | Current | Proposed | Why |
|---|---|---|---|
| `builder.shape.circleHint` | الدوائر متلاصقة بالصف، و2 ملم بين الأعمدة. | الدوائر متلاصقة بالصف، و{gap} ملم بين الأعمدة. | `circleGapXUm` is editable |
| `builder.shape.roundedHint` | فراغ 2 ملم بين الستيكرات | فراغ {gap} ملم بين الستيكرات | `rectRoundedGapUm` |
| `builder.shape.customHint`/`sharpHint` | (sharp) بدون فراغ | keep, but derive from `rectSharpGapUm === 0` | |
| `builder.preview.marginHint` | ~~الهامش 10 ملم من كل جهة~~ | الهامش {margin} ملم من كل جهة — **done** | `marginUm` |
| `builder.upload.accepted` / `acceptedCustom` | ... حد أقصى 10 ميغابايت | ... حد أقصى {mb} ميغابايت | `maxUploadBytes` |
| `builder.upload.errors.too_large` | الملف أكبر من 10 ميغابايت | الملف أكبر من {mb} ميغابايت | same |
| `builder.size.errors.too_small` | أصغر قياس مسموح 0.5 سم. | أصغر قياس مسموح {min} سم. | `minSideUm` |
| `builder.offer.deliveryNote` etc. | already uses `{fee}` | OK | good pattern |

## 2. Register and word choice

| Key | Current | Proposed | Why |
|---|---|---|---|
| `common.nav.start` / `common.nav.startNow` / `builder.hero.cta` / `pages.howItWorks.cta` | صمّم ستيكراتك / ابدأ هسة / ابدأ التصميم | One primary CTA phrase, e.g. «صمّم ستيكراتك» everywhere, «ابدأ هسة» only as the secondary | Three names for one action; consistency builds trust (P2) |
| `builder.hero.title` | ستيكراتك، على قياسك، بورقة A4 | ستيكراتك على قياسك، على ورقة A4 | «بورقة» reads as "with a sheet"; «على ورقة» is the natural phrase. Also two commas break the rhythm |
| `builder.upload.transparentHint` | نقص على شكله بالضبط | نقطعه على شكله بالضبط | «نقص» unvoweled reads as "we reduce"; «نقطع» is unambiguous (P1) |
| `builder.degraded.body` | لا تخاف، طلبك ما راح يضيع. | لا تقلق، طلبك ما راح يضيع. | «لا تخاف» sounds like a threat context; «لا تقلق» (or «لا تشيل هم») is warmer (P2) |
| `common.actions.download` | حمّل الملف | نزّل الملف | Iraqis say «نزّل» for download and «ارفع» for upload; «حمّل» is ambiguous (P2) |
| `common.status.loading/saving/uploading/processing` | جارٍ ... | جاري ... | «جارٍ» is stiff newsreader MSA; «جاري» is what people read and say. Keep the ellipsis (P3) |
| `builder.size.dpiLabel` | جودة الطباعة: {dpi} نقطة/إنش | جودة الطباعة: {dpi} DPI | Printers and customers know "DPI"; «نقطة/إنش» is a literal translation nobody uses. The value must be inside `<Ltr>` (P2) |
| `builder.size.dpiWarn` | راح تطلع مشوشة | راح تطلع بجودة واطية / ضبابية | «مشوشة» means "jammed/disturbed" (like radio static); «ضبابية» (blurry) is the intended meaning (P2) |
| `builder.upload.cropNotice` | الصورة مو مربعة، راح نقصها من المنتصف... | الصورة مو مربعة، راح نقطعها من المنتصف حتى تصير دائرة. | same «نقص» ambiguity |
| `builder.details.landmarkPlaceholder` | مثلاً: قرب جامع الرحمن، شارع الصناعة | مثلاً: قرب مطعم ..، شارع الصناعة | A specific mosque name looks like a real address/tie; use a generic landmark (P3) |
| `builder.offer.stickersTotal` | ستيكر بالمجموع | ستيكر بالمجموع | OK as is; but the plural helper should drive the noun if it ever sits next to a number other than "many" (check the card renders `count()`) |

## 3. Register consistency (UI colloquial, errors/legal neutral)

The plan says errors and legal text are neutral, but the current errors are Iraqi-colloquial («صار خطأ», «ما قدرنا», «راح نستخدم»). This is acceptable and friendlier on a small shop's site, but it is inconsistent with the stated rule. Recommendation: **keep errors colloquial** (they read as human, and Iraqi customers distrust stiff text), and make only the legal/consent line neutral. Update the rule in CLAUDE.md/PLAN rather than the copy, or else rewrite these:

| Key | Current | Neutral alternative |
|---|---|---|
| `common.errors.generic` | صار خطأ غير متوقع. جرّب مرة ثانية. | حدث خطأ غير متوقع. حاول مرة أخرى. |
| `builder.upload.errors.corrupt` | ما قدرنا نقرأ الملف... | تعذّرت قراءة الملف... |
| `builder.details.consent` | بياناتك وملفك تُستخدم لتنفيذ طلبك فقط وتُحذف بعد {days} يوم. | OK (already neutral). Note `{days}` + «يوم» needs a plural: 30 → «يوم» is correct, but 3-10 would need «أيام». Use `count(days, plural.day)` or phrase «بعد مرور {days} يوماً» |

Also the footer line `common.footer.filesNotice` says "used to fulfil your order only" and does not mention deletion, while the consent line promises deletion after N days. Align them (footer: «... وتُحذف بعد {days} يوم من التنفيذ») or the shop makes two different promises.

## 4. Typos / mechanics

| Key | Issue | Fix |
|---|---|---|
| `builder.upload.onlyFirstPage` | «({pages} صفحات)» is always plural even for 2 pages | use `count(pages, plural.page)`: «(2 صفحتين)» is odd; prefer «ملف PDF من {pages} صفحة: راح نستخدم الصفحة الأولى فقط.» |
| `builder.upload.errors.switchToRect` | lives inside `errors` but is a button label, not an error | move to `builder.upload.switchToRect` (key tidy) |
| `common.units.mm` / `cm` | ملم / سم | fine; keep «ملم» consistently (it is, good) |
| `builder.offer.perSticker` | ≈ {price} د.ع للستيكر | ≈ is a math symbol that may not render in the Arabic font's fallback; «حوالي {price} د.ع للستيكر» |
| `builder.details.errors.invalid_phone` | لازم يبدأ بـ 07 ويكون 11 رقم | «لازم يبدأ بـ <Ltr>07</Ltr> ويتكون من 11 رقم»; the component must wrap digits in `<Ltr>` |
| `common.plural.*.zero` | `sticker.zero: 'ستيكرات'` | fine for "0 ستيكرات"; just make sure the engine never shows "0" as a result (min is 1) |
| `common.nav.inquiry` | استفسار | fine for the floating button; consider «اسأل عن طلبك» if the button is meant for pre-sale questions |

## 5. Things a Baghdad customer might find odd

1. **Prices unset everywhere** («السعر يُحدد عند التأكيد» on every card) reads like "we will quote you" and may put people off. Not a copy bug; consider showing «أسعار الجملة على الواتساب» as a bridge until prices are published.
2. **«باقة»** for the sheet bundles is fine, but the cards say «20 ورقة A4» without saying what the customer gets. A one-line benefit under the title would help: «تكفي ≈ {n} ستيكر».
3. **«الستيكرات متلاصقة»** for sharp rectangles may be misread as "they will stick together". Say «بدون فراغ بينها» (no gap between them).
4. **«المندوب»** (courier) in `landmark` error is correct Iraqi usage. Keep.
5. **Male imperative only.** The whole UI addresses the user as masculine (اختار, ارفع). It is the default in Iraqi UIs and acceptable; do not try to gender it.
6. **Brand written two ways**: «الاتحاد برنت» (copy) vs "Al-Ittihad Print" (OG image only). Fine, but if the shop uses a Latin name on signage, tell us and the OG card will use it.

## 6. Top 5 to apply first

1. Placeholders for margin / gap / max size / min size / upload MB (section 1).
2. One primary CTA wording (section 2).
3. «نقص» → «نقطع» (two keys).
4. «لا تخاف» → «لا تقلق»; «مشوشة» → «ضبابية»; «نقطة/إنش» → DPI.
5. Align footer notice and consent line about deletion; fix `{days}` / `{pages}` plural mechanics.


---

# Copy review

## Agent C needs

Strings the builder UI would like but which are not in the frozen dictionaries (closest existing key used meanwhile):

- `builder.upload.pixelsUnit` — «بكسل», to label the artwork dimensions on the design preview (currently shows only "W × H" in `<Ltr>`).
- `builder.preview.close` (or reuse `common.actions.close`) — the shared Dialog close button has an English sr-only "Close" in `components/ui/dialog.tsx` (frozen).
- `builder.offer.noOffers` — empty state when the owner has disabled every offer (currently renders an empty list).
- `builder.stepper.label` — accessible name for the step navigation (currently `builder.hero.title`).
- `builder.size.countHint` — screen-reader announcement of the per-sheet count when the size changes (currently the bare number).
- `builder.upload.removeFile` — a "remove file" action (currently only «غيّر الملف»).
