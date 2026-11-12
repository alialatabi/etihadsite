/**
 * Hidden staff page copy (reached only through the secret link). Size, DPI and file errors reuse
 * the builder copy (`builder.size.errors`, `builder.upload.errors`) where the meaning is identical.
 */
export const staff = {
  title: 'ورقة الموظفين',
  adminLinkLabel: 'رابط صفحة الموظفين (سري، لا تنشره)',
  intro: 'ارفع التصاميم، اكتب قياس كل تصميم، ونطلعلك ملف PDF لكل تصميم، جاهز للطباعة والقص.',
  drop: 'اسحب الملفات هنا أو اضغط للاختيار',
  dropMore: 'ضيف ملفات ثانية',
  /** {max} = files, {mb} = megabytes per file. */
  accepted: 'PNG أو JPG أو PDF، لحد {max} ملف، وكل ملف لحد {mb} ميغابايت. الملفات تبقى عندك بالجهاز وما تنرفع لأي مكان.',
  /** {max} = the file limit. */
  tooMany: 'الحد الأقصى {max} ملف. الملفات الزايدة ما انضافت.',
  empty: 'ما أضفت أي تصميم بعد.',
  shapeLabel: 'الشكل',
  shapes: {
    circle: 'دائري',
    rounded: 'مستطيل بزوايا دائرية',
    sharp: 'مستطيل بزوايا حادة',
    custom: 'شكل مخصص (PNG شفاف)',
  },
  /** {name} = file name. */
  removeAria: 'احذف {name}',
  /** Low resolution is a warning only on this page: the employee decides. */
  lowDpi: 'دقة الصورة قليلة وراح تطلع ضبابية. تكدر تنزّل الملف مع ذلك.',
  /** {designs} = "3 تصاميم", {files} = "3 ملفات". */
  summary: '{designs}، يعني {files}.',
  download: 'نزّل ملفات PDF',
  /** {name} = file name; the small download button on one card. */
  downloadOne: 'نزّل PDF لـ {name}',
  /** Shown under the main button when there are 2 or more cards. */
  multiHint: 'إذا سألك المتصفح عن تنزيل أكثر من ملف، اختار «سماح» (Allow).',
  /** {n} = the file being prepared, {total} = how many. */
  preparing: 'جاري تجهيز الملف {n} من {total}…',
  needValid: 'لازم كل تصميم يكون جاهز وقياسه صحيح حتى ينزل الملف.',
  /** {name} = file name; followed by the reason. */
  prepareFailed: 'تعذر تجهيز «{name}».',
  /** {percent} = the print scale. */
  printActualSize: 'اطبع الملف بحجم {percent}% (Actual size). لا تختار «ملاءمة الصفحة» حتى تبقى النقاط السودة بمكانها.',
} as const;
