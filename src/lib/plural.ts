/**
 * Arabic plural agreement. Pure.
 *
 * Uses Intl.PluralRules('ar'): categories zero, one, two, few (3–10), many (11–99), other (100+, 0 handled as zero).
 * `count(n, forms)` returns the text WITHOUT the number; UI composes "<Ltr>{n}</Ltr> {count(...)}".
 * Examples with common.plural.sticker: 1 → "ستيكر", 2 → "ستيكرين", 3 → "ستيكرات", 11 → "ستيكر", 100 → "ستيكر".
 */
export interface PluralForms {
  zero: string;
  one: string;
  two: string;
  few: string;
  many: string;
  other: string;
}

const rules = new Intl.PluralRules('ar');

export function count(n: number, forms: PluralForms): string {
  return forms[rules.select(n) as keyof PluralForms];
}

/** "54 ستيكر" style helper: number (Western digits) + space + plural form. */
export function countLabel(n: number, forms: PluralForms): string {
  return `${n} ${count(n, forms)}`;
}

const COUNT_FORMAT = new Intl.NumberFormat('ar-IQ-u-nu-latn', { maximumFractionDigits: 0 });

/** "1,080": a count for display, Western digits grouped like formatIqd(). Not for input values. */
export function formatCount(n: number): string {
  return COUNT_FORMAT.format(n);
}
