# الاتحاد برنت / Al-Ittihad Print

موقع عربي (من اليمين لليسار) لطلب ستيكرات مطبوعة على ورق A4. / An Arabic-only (RTL) site for ordering A4 sticker sheets.

---

## بالعربي (لصاحب المطبعة)

### شنو يسوي الموقع؟
الزبون يختار الشكل (دائري، مستطيل، أو مخصص)، يرفع تصميمه (PNG أو JPG أو PDF)، يكتب القياس بالسنتيمتر، فيشوف ورقة A4 مرتبة قدامه مع عدد الستيكرات بالورقة. بعدين يختار الباقة (20 / 50 / 100 ورقة)، يكتب اسمه وعنوانه ورقمه، ويرسل الطلب. الطلب يوصلك على تيليغرام، ويطلع لك ملف PDF جاهز للطباعة بالقياس الحقيقي.

صفحة «شلون نشتغل؟» تحسب أرقامها من نفس محرك الترتيب، فإذا غيّرت الهامش أو الفراغات من الإعدادات تتغير الأرقام لحالها.

### تشغيل الموقع على جهازك
```bash
pnpm install
cp .env.example .env.local     # على ويندوز: copy .env.example .env.local
pnpm dev
```
افتح <http://localhost:3000>. افتح `.env.local` وغيّر كلمة سر الإدارة (`ADMIN_PASSWORD`) والمفتاح السري (`SESSION_SECRET`: نص عشوائي طويل).

### لوحة الإدارة
افتح `/admin` وسجّل الدخول بكلمة السر اللي حطيتها بـ `ADMIN_PASSWORD`. من هناك تشوف الطلبات وتنزّل ملفات الطباعة وتغيّر حالة الطلب (جديد، قيد الطباعة، تم، ملغي).

### شلون أغيّر السعر أو رقم الواتساب؟
من لوحة الإدارة: **الإعدادات**.
- **أرقام الواتساب والهاتف، أوقات العمل، المنطقة:** تتغير مباشرة وتظهر بالهيدر والفوتر.
- **الأسعار:** اكتب سعر كل باقة، ثم فعّل «نشر الأسعار». قبل التفعيل الموقع يعرض «السعر يُحدد عند التأكيد» ولا يعرض أي رقم.
- **التوصيل:** 5,000 د.ع افتراضياً، تتغير من نفس الصفحة.
- **الهامش والفراغات بين الستيكرات:** من نفس الصفحة (الافتراضي: هامش 10 ملم؛ دوائر 2 ملم بين الأعمدة والصفوف متلاصقة).

اكتب رقم الواتساب بالصيغة الدولية بدون + (مثال: `9647701234567`).

### شلون أسوي بوت تيليغرام لاستلام الطلبات؟
1. افتح تيليغرام وابحث عن **@BotFather**، اكتب `/newbot` واختار اسم للبوت. راح يعطيك **توكن** (نص طويل).
2. افتح البوت اللي سويته واضغط Start وأرسل له أي رسالة (إذا تريد الطلبات بكروب: أضف البوت للكروب وأرسل رسالة).
3. افتح بالمتصفح: `https://api.telegram.org/bot<التوكن>/getUpdates` وابحث عن `"chat":{"id":...}`. هذا هو **chat id** (ويكون سالب للكروبات).
4. بملف `.env.local`:
   ```
   ORDER_TRANSPORT=telegram
   TELEGRAM_BOT_TOKEN=التوكن
   TELEGRAM_CHAT_ID=الرقم
   ```
5. أعد تشغيل الموقع. اعمل طلب تجريبي وتأكد يوصلك.

قبل ما تسوي البوت خلّ `ORDER_TRANSPORT=console` (الطلبات تظهر بشاشة السيرفر فقط وتنحفظ بالإدارة).

### وين تنحفظ الملفات؟
بمجلد `./data` على نفس الجهاز (الطلبات، التصاميم المرفوعة، وملفات PDF). المجلد ما ينرفع على git. خذ منه نسخة احتياطية بين فترة وفترة.

**الحذف بعد 30 يوم:** شغّل هذا الأمر (يفضل مرة باليوم عبر Task Scheduler على ويندوز):
```bash
pnpm tsx scripts/purge-orders.ts
```
يحذف الطلبات والملفات الأقدم من مدة الاحتفاظ (30 يوم افتراضياً).

### نصائح الطباعة (مهم)
- اطبع ملف PDF بحجم **100% / «الحجم الفعلي» (Actual size)**. لا تختار أبداً **«Fit to page»** أو «ملاءمة الصفحة»، لأنها تصغّر الورقة وتخرب القياس.
- الملف يحتوي التصميم فقط، بدون خطوط قص ولا علامات. **خطوط القص تضيفها المطبعة** من برنامج البلوتر (cutter plotter).
- رقم الطلب محفوظ بخصائص الملف (Metadata) وليس مطبوعاً على الورقة.
- مقاس الورقة 21 × 29.7 سم والهامش 10 ملم من كل جهة، والترتيب مركّز بالمنتصف.

### النشر لاحقاً (على الإنترنت)
حالياً الموقع يشتغل محلياً فقط. لما تقرر تنشره:
- حساب GitHub ومشروع Vercel باسمك، وباقة **Vercel Pro** (الباقة المجانية ما تسمح بالاستخدام التجاري).
- التخزين يتحول إلى **Vercel Blob** (`STORAGE=blob`) لأن السيرفر السحابي ما عنده قرص دائم.
- فعّل **Cloudflare Turnstile** (مجاني) ضد الطلبات الوهمية، وبدّل محدد الطلبات (rate limit) الموجود بالذاكرة بخدمة مستضافة.
- `ORDER_TRANSPORT=telegram`.
- الأمر بالتفصيل بالملف `docs/STACK_NOTES.md`.

---

## English (for the shop owner and developers)

### What it does
Customers pick a sticker shape (circle, rectangle with rounded or sharp corners, or custom die-cut), upload one design (PNG, JPG or PDF, first page only), enter the size in cm and see a live A4 preview with the per-sheet count. They choose an offer (20 / 50 / 100 sheets) and submit name, phone and address. The shop receives the order on Telegram plus a print-ready artwork-only PDF, and can manage orders and settings in `/admin`.

The «شلون نشتغل؟» page (`/how-it-works`) computes its numbers with the same layout engine (`computeLayout`) using the live settings, so it never drifts from the builder. With the defaults, a 3 cm circle gives 54 stickers per sheet.

### Stack
Next.js 16 (App Router), TypeScript, Tailwind v4, shadcn/ui (base-nova, RTL), pnpm. `pdf-lib` and `sharp` on the server, `pdfjs-dist` in the browser preview, zod, jose (admin session). See `docs/PLAN.md` and `docs/STACK_NOTES.md`.

### Run locally
```bash
pnpm install
cp .env.example .env.local
pnpm dev            # http://localhost:3000
```
Checks: `pnpm typecheck && pnpm test && pnpm lint && pnpm lint:rtl`.

### Environment
| Variable | Purpose |
|---|---|
| `ADMIN_PASSWORD` | Password for `/admin` |
| `SESSION_SECRET` | Long random string used to sign the admin cookie |
| `ORDER_TRANSPORT` | `console` (default) or `telegram` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Telegram delivery |
| `STORAGE` | `local` (files in `./data`); `blob` later |

### Admin and settings
`/admin` shows orders and a settings form: shop name, tagline, phone, WhatsApp (international digits, no `+`, e.g. `9647701234567`), hours, offers and prices, delivery fee, layout margin and gaps. Prices stay hidden («السعر يُحدد عند التأكيد») until «publish prices» is on and the offer has a price.

### Telegram bot
1. Talk to **@BotFather**, `/newbot`, copy the token.
2. Send any message to the bot (or add it to a group and post).
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `message.chat.id`.
4. Set `ORDER_TRANSPORT=telegram`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` in `.env.local`, restart.

### Data and retention
Orders, uploads and generated PDFs live under `./data` (gitignored). Purge anything older than the retention period (default 30 days) with `pnpm tsx scripts/purge-orders.ts`; schedule it daily.

### Printing
The PDF contains artwork only: no cut paths, tick marks or text. Print at 100% / "Actual size", never "Fit to page". Cut lines are added by the shop in the plotter software. The order id is stored in the PDF metadata.

### Layout rules (defaults, editable in settings)
A4 21 × 29.7 cm, 10 mm margin, block centred. Circle: 2 mm between columns, rows touching. Rounded rectangle: 2 mm. Sharp rectangle: 0. Custom: 2 mm and requires a transparent PNG.

### Icons and metadata
`node scripts/make-icons.mjs` regenerates `src/app/{favicon.ico,icon.png,apple-icon.png}` and `public/icon-*.png` from `public/brand/united-print-logo.jpg`. The Open Graph image (`src/app/opengraph-image.tsx`) draws the logo with Latin text so it needs no Arabic font at build time. Set `metadataBase` in the root layout once a domain exists.

### Deploying later
Not deployed for now (owner's decision). When ready: GitHub repo + Vercel project under the owner's accounts, Vercel **Pro** (Hobby forbids commercial use), the `blob` storage adapter (serverless has no persistent disk; the `StorageAdapter` interface in `src/lib/types.ts` is the seam), Cloudflare Turnstile keys, a hosted rate limiter instead of the in-memory one, and `ORDER_TRANSPORT=telegram`. Details: `docs/STACK_NOTES.md`.

### Copy
All Arabic text lives in `src/content/ar/*`. Suggested wording changes are tracked in `docs/copy-review.md`.
