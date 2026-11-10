/**
 * Shared Arabic copy — FROZEN during Phase 1 (orchestrator applies edits from copy-review.md).
 * Register: Iraqi colloquial for UI verbs and headlines; neutral for errors and legal text.
 * Digits: Western (0-9). Numbers, units, file names and phone numbers are wrapped in <Ltr>.
 */
export const common = {
  brand: 'مطبعة سوفتي',
  tagline: 'ستيكرات على قياسك',
  nav: {
    home: 'الرئيسية',
    howItWorks: 'شلون نشتغل؟',
    start: 'صمّم ستيكراتك',
    startNow: 'ابدأ هسة',
    whatsapp: 'واتساب',
    inquiry: 'استفسار',
  },
  actions: {
    next: 'التالي',
    back: 'رجوع',
    continue: 'كمّل',
    change: 'تغيير',
    remove: 'حذف',
    retry: 'جرّب مرة ثانية',
    close: 'إغلاق',
    download: 'نزّل الملف',
    copy: 'نسخ',
    save: 'حفظ',
    cancel: 'إلغاء',
  },
  units: {
    cm: 'سم',
    mm: 'ملم',
    iqd: 'د.ع',
    perSticker: 'للستيكر',
    perSheet: 'بالورقة',
    a4: 'A4',
  },
  /** Sticker sheet material (keys = Material in src/lib/types.ts). */
  materials: {
    paper: 'ورقي',
    plastic: 'بلاستك',
  },
  status: {
    loading: 'جاري التحميل…',
    saving: 'جاري الحفظ…',
    uploading: 'جاري رفع الملف…',
    processing: 'جاري تجهيز الطلب…',
    done: 'تم',
  },
  errors: {
    generic: 'صار خطأ. جرّب مرة ثانية.',
    network: 'ما قدرنا نوصل للسيرفر. تأكد من الإنترنت وجرّب مرة ثانية.',
    rateLimited: 'طلبات كثيرة. انتظر شوية وجرّب مرة ثانية.',
  },
  footer: {
    filesNotice: 'ملفاتك وبياناتك تُستخدم لتنفيذ طلبك فقط وتُحذف بعد 30 يوم من التنفيذ.',
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
