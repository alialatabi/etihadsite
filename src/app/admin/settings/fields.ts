/**
 * The layout distances of the settings form: typed in millimetres under `name`, stored in
 * micrometres under `key` of ShopSettings['layout']. One table for the form (SettingsForm.tsx,
 * a client component) and for the parser (parse-form.ts), in the order the form shows them.
 * No imports on purpose: this file is bundled for the browser and must stay free of zod.
 */
export const LAYOUT_MM_FIELDS = [
  { name: 'margin', key: 'marginUm' },
  { name: 'circleGapX', key: 'circleGapXUm' },
  { name: 'circleGapY', key: 'circleGapYUm' },
  { name: 'roundedGap', key: 'rectRoundedGapUm' },
  { name: 'sharpGap', key: 'rectSharpGapUm' },
  { name: 'customGap', key: 'customGapUm' },
  { name: 'roundedRadius', key: 'roundedRadiusUm' },
] as const;
