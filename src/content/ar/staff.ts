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
  /** The two tabs of the staff page. */
  tabs: {
    label: 'نوع الشغل',
    stickers: 'الستيكرات',
    receipts: 'الوصولات',
  },
  /** The receipts (الوصولات) tab: receipt books imposed on A4. Shared strings (drop, accepted, download…) are the sticker tab's. */
  receipts: {
    intro: 'ارفع تصميم الوصل واختار قياسه، ونطلعلك ملف PDF على ورقة A4 جاهز للطباعة. البياض يبقى بمكان التخريم والكبس.',
    empty: 'ما أضفت أي وصل بعد.',
    formatLabel: 'قياس الوصل',
    formats: { a4: 'A4', a5: 'A5', a6: 'A6', dl: 'DL' },
    /** Width x height in cm, as the owner wrote them. */
    sizes: { a4: '21 × 28.5', a5: '15 × 19.5', a6: '10 × 15', dl: '19.5 × 10' },
    /** {size} = the size in cm, {n} = receipts per A4 sheet. */
    formatDetail: '{size} سم، {n} بالورقة',
    turn: 'لف التصميم',
    whiteLabel: 'مكان البياض',
    whiteTop: 'فوق',
    whiteBottom: 'تحت',
    multiPage: 'الملف بيه أكثر من صفحة. نستخدم الصفحة الأولى بس.',
    previewAria: 'معاينة ورقة A4',
    /** {receipts} = "3 وصولات", {files} = "3 ملفات". */
    summary: '{receipts}، يعني {files}.',
    /** {percent} = the print scale. */
    printHint: 'اطبع الملف بحجم {percent}% (Actual size) على ورق A4.',
    /** The white around and between the receipts of one file (millimetres, physical sides of the paper). */
    spacing: {
      title: 'المسافات (ملم)',
      top: 'فوق',
      bottom: 'تحت',
      right: 'يمين',
      left: 'يسار',
      /** One gap: between the receipts (A5, DL). */
      gap: 'بين التصاميم',
      gapX: 'بين الأعمدة',
      gapY: 'بين الصفوف',
      reset: 'رجّع المسافات الافتراضية',
      /** {lowMm} and {highMm} = the limits in mm. */
      invalid: 'اكتب رقم من {lowMm} إلى {highMm} ملم.',
      noRoom: 'المسافات كبيرة وما يبقى مكان كافي للتصميم. صغّر المسافات.',
      /** {formatName} = A6. */
      a6Hint: 'بالـ {formatName} المسافة بين الصفوف هي بياض الصف الثاني.',
      /** The same hint when the white strip is at the bottom (the gap is then the first row's white). {formatName} = A6. */
      a6HintBottom: 'بالـ {formatName} المسافة بين الصفوف هي بياض الصف الأول.',
    },
  },
} as const;
