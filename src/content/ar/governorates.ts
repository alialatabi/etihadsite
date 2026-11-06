/** Iraq's 19 governorates (Halabja added 2025). Baghdad first, then alphabetical. FROZEN. */
export const governorates = [
  'بغداد',
  'أربيل',
  'الأنبار',
  'البصرة',
  'بابل',
  'دهوك',
  'ديالى',
  'ذي قار',
  'السليمانية',
  'صلاح الدين',
  'القادسية',
  'كربلاء',
  'كركوك',
  'المثنى',
  'ميسان',
  'النجف',
  'نينوى',
  'واسط',
  'حلبجة',
] as const;

export type Governorate = (typeof governorates)[number];
