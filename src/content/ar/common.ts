/**
 * Shared Arabic copy: brand, navigation, actions, units, materials, statuses, errors, footer
 * and plural forms. Visible text, pinned by tests/unit/golden/copy.golden.test.ts: changing a
 * string is a content change, not a refactor.
 * Register: Iraqi colloquial for UI verbs and headlines; neutral for errors and legal text.
 * Digits: Western (0-9). Numbers, units, file names and phone numbers are wrapped in <Ltr>.
 */
export const common = {
  brand: 'مطبعة سوفتي',
  nav: {
    home: 'الرئيسية',
    howItWorks: 'شلون نشتغل؟',
    start: 'صمّم ستيكراتك',
    whatsapp: 'واتساب',
    inquiry: 'استفسار',
  },
  actions: {
    next: 'التالي',
    back: 'رجوع',
    retry: 'جرّب مرة ثانية',
  },
  units: {
    cm: 'سم',
    mm: 'ملم',
    iqd: 'د.ع',
    a4: 'A4',
  },
  /** Sticker sheet material (keys = Material in src/lib/types.ts). */
  materials: {
    paper: 'ورقي',
    plastic: 'بلاستك',
  },
  status: {
    loading: 'جاري التحميل…',
    uploading: 'جاري رفع الملف…',
    processing: 'جاري تجهيز الطلب…',
  },
  errors: {
    generic: 'صار خطأ. جرّب مرة ثانية.',
    rateLimited: 'طلبات كثيرة. انتظر شوية وجرّب مرة ثانية.',
  },
  footer: {
    filesNotice: 'ملفات التصميم تنحذف بعد 30 يوم. رقمك وعنوانك نحتفظ بيهم حتى نخدمك بالطلبات الجاية، وما نشاركهم ويا أحد.',
    rights: 'جميع الحقوق محفوظة',
    hours: 'أوقات العمل',
    contact: 'تواصل معنا',
  },
  plural: {
    sticker: { zero: 'ستيكرات', one: 'ستيكر', two: 'ستيكرين', few: 'ستيكرات', many: 'ستيكر', other: 'ستيكر' },
    sheet: { zero: 'أوراق', one: 'ورقة', two: 'ورقتين', few: 'أوراق', many: 'ورقة', other: 'ورقة' },
    design: { zero: 'تصاميم', one: 'تصميم', two: 'تصميمين', few: 'تصاميم', many: 'تصميم', other: 'تصميم' },
    page: { zero: 'صفحات', one: 'صفحة', two: 'صفحتين', few: 'صفحات', many: 'صفحة', other: 'صفحة' },
  },
} as const;
