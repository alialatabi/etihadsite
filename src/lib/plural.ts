/**
 * Arabic plural agreement — OWNED BY AGENT A. Pure.
 *
 * Uses Intl.PluralRules('ar'): categories zero, one, two, few (3–10), many (11–99), other (100+, 0 handled as zero).
 * `count(n, forms)` returns the text WITHOUT the number; UI composes "<Ltr>{n}</Ltr> {count(...)}".
 * Examples with STICKER_FORMS: 1 → "ستيكر", 2 → "ستيكرين", 3 → "ستيكرات", 11 → "ستيكر", 100 → "ستيكر".
 */
export interface PluralForms {
  zero: string;
  one: string;
  two: string;
  few: string;
  many: string;
  other: string;
}

export function count(n: number, forms: PluralForms): string {
  void n;
  void forms;
  throw new Error('NOT_IMPLEMENTED: count (Agent A)');
}

/** "54 ستيكر" style helper: number (Western digits) + space + plural form. */
export function countLabel(n: number, forms: PluralForms): string {
  void n;
  void forms;
  throw new Error('NOT_IMPLEMENTED: countLabel (Agent A)');
}
