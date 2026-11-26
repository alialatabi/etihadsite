/**
 * Staff designer copy (/team, reached by phone + password). Not the secret sheet page: that one is `staff`.
 * Placeholders use {name}; numbers filled into them are wrapped in <Ltr> by the page.
 */
export const team = {
  title: 'مصمم سوفتي — للموظفين',
  login: {
    title: 'دخول الموظفين',
    phone: 'رقم الموبايل',
    password: 'كلمة السر',
    submit: 'دخول',
    error: 'رقم الموبايل أو كلمة السر غلط، أو الحساب موقوف.',
    rateLimited: 'محاولات كثيرة. انتظر شوية وجرّب مرة لخ.',
    unavailable: 'صفحة الموظفين مو جاهزة هسه.',
  },
  /** {name} = the staff member's name. */
  hello: 'هلا {name}',
  logout: 'خروج',
  shape: 'الشكل',
  size: 'القياس (سم)',
  download: 'نزّل التصميم PNG',
  newDesign: 'تصميم جديد',
  savedNote: 'كل تصميم ينحفظ بمعرض التصاميم بالإدارة.',
  /** {n} = the daily limit. */
  limitReached: 'خلصت محاولاتك لليوم ({n}). ارجع باچر.',
  /** The session ended (logged out, account disabled, password reset): the routes answer 'unauthorized'. */
  sessionEnded: 'طلعت من الحساب. سجّل دخول مرة لخ.',
} as const;
