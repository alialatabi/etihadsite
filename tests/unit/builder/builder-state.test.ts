import { describe, expect, it } from 'vitest';

import {
  CUSTOMER_FIELD_IDS,
  restoredState,
  toCustomerInfo,
  validateCustomer,
  type FormFields,
  type PersistedForm,
} from '@/components/builder/logic';

/* ───────────────────────── restoredState ───────────────────────── */

/**
 * The restore effect of useBuilder as it was before restoredState() existed: the same
 * conditions in the same order, with setters that record what they were called with.
 */
function restoreBefore(saved: Partial<PersistedForm>): Record<string, unknown> {
  const calls: Record<string, unknown> = {};
  const set = (key: string) => (value: unknown) => {
    calls[key] = value;
  };
  const setShapeState = set('shape');
  const setCorners = set('corners');
  const setWidthText = set('widthText');
  const setHeightText = set('heightText');
  const setSizeUm = set('sizeUm');
  const setMaterialChoice = set('material');
  const setStickersText = set('stickersText');
  const setFields = set('fields');

  if (saved.shape) setShapeState(saved.shape);
  if (saved.corners) setCorners(saved.corners);
  if (typeof saved.widthText === 'string') setWidthText(saved.widthText);
  if (typeof saved.heightText === 'string') setHeightText(saved.heightText);
  if (saved.sizeUm) setSizeUm(saved.sizeUm);
  if (saved.material === 'paper' || saved.material === 'plastic') setMaterialChoice(saved.material);
  if (typeof saved.stickersText === 'string' && saved.stickersText.trim()) setStickersText(saved.stickersText);
  setFields({
    name: saved.name ?? '',
    phone: saved.phone ?? '',
    governorate: saved.governorate ?? '',
    district: saved.district ?? '',
    landmark: saved.landmark ?? '',
    notes: saved.notes ?? '',
  });
  return calls;
}

const NO_FIELDS = { name: '', phone: '', governorate: '', district: '', landmark: '', notes: '' };
const FULL: PersistedForm = {
  shape: 'rect',
  corners: 'sharp',
  widthText: '3',
  heightText: '4.5',
  sizeUm: { widthUm: 30_000, heightUm: 45_000 },
  material: 'plastic',
  stickersText: '25',
  name: 'علي',
  phone: '0770 123 4567',
  governorate: 'بغداد',
  district: 'الكرادة',
  landmark: 'قرب الجامع',
  notes: 'بدون استعجال',
};
/** loadForm() returns whatever JSON object was stored, so junk has to be handled too. */
const junk = (value: unknown) => value as Partial<PersistedForm>;

const CASES: { name: string; saved: Partial<PersistedForm>; expected: Record<string, unknown> }[] = [
  {
    name: 'a complete saved form',
    saved: FULL,
    expected: {
      shape: 'rect',
      corners: 'sharp',
      widthText: '3',
      heightText: '4.5',
      sizeUm: { widthUm: 30_000, heightUm: 45_000 },
      material: 'plastic',
      stickersText: '25',
      fields: { name: 'علي', phone: '0770 123 4567', governorate: 'بغداد', district: 'الكرادة', landmark: 'قرب الجامع', notes: 'بدون استعجال' },
    },
  },
  { name: 'an empty object', saved: {}, expected: { fields: NO_FIELDS } },
  {
    name: 'a form saved by the sheet-count page: its sheetsText is ignored',
    saved: junk({ shape: 'circle', material: 'paper', sheetsText: '25' }),
    expected: { shape: 'circle', material: 'paper', fields: NO_FIELDS },
  },
  { name: 'an array (valid JSON object)', saved: junk([]), expected: { fields: NO_FIELDS } },
  {
    name: 'a partial form: empty size texts are kept, a blank sticker text is not',
    saved: { shape: 'circle', widthText: '', heightText: '', stickersText: '   ', phone: '0770' },
    expected: { shape: 'circle', widthText: '', heightText: '', fields: { ...NO_FIELDS, phone: '0770' } },
  },
  {
    name: 'a circle with paper and an untrimmed sticker text',
    saved: { shape: 'circle', corners: 'rounded', sizeUm: { widthUm: 50_000, heightUm: 50_000 }, material: 'paper', stickersText: ' 20 ' },
    expected: { shape: 'circle', corners: 'rounded', sizeUm: { widthUm: 50_000, heightUm: 50_000 }, material: 'paper', stickersText: ' 20 ', fields: NO_FIELDS },
  },
  {
    name: 'null and missing values',
    saved: junk({ shape: null, corners: undefined, widthText: null, sizeUm: null, material: null, stickersText: '', name: null, notes: undefined }),
    expected: { fields: NO_FIELDS },
  },
  {
    name: 'junk types: non-strings and unknown materials are dropped',
    saved: junk({ corners: 0, widthText: 3, heightText: { a: 1 }, sizeUm: 0, material: 'gold', stickersText: 12 }),
    expected: { fields: NO_FIELDS },
  },
  {
    name: 'junk that passes the truthiness rules is passed through unchanged',
    saved: junk({ shape: 'hexagon', corners: 'wavy', sizeUm: 'big', name: 42, phone: 0, district: false, notes: { a: 1 } }),
    expected: { shape: 'hexagon', corners: 'wavy', sizeUm: 'big', fields: { ...NO_FIELDS, name: 42, phone: 0, district: false, notes: { a: 1 } } },
  },
  ...['Paper', 'PLASTIC', '', ' paper', ['paper'], 1, true, {}].map((material) => ({
    name: `material ${JSON.stringify(material)} is not a known material`,
    saved: junk({ material }),
    expected: { fields: NO_FIELDS },
  })),
];

describe('restoredState', () => {
  it.each(CASES)('$name', ({ saved, expected }) => {
    const restored = restoredState(saved);
    expect(restored).toStrictEqual(expected);
    // Same accepted values, same keys, as the setters the effect used to call.
    expect(restored).toStrictEqual(restoreBefore(saved));
  });

  it('accepts exactly the two materials', () => {
    expect(restoredState({ material: 'paper' }).material).toBe('paper');
    expect(restoredState({ material: 'plastic' }).material).toBe('plastic');
  });

  it('does not copy keys it does not know, and does not change its input', () => {
    const saved = junk({ ...FULL, extra: 'x', step: 3 });
    const before = JSON.stringify(saved);
    expect(Object.keys(restoredState(saved)).sort()).toEqual(['corners', 'fields', 'heightText', 'material', 'shape', 'sizeUm', 'stickersText', 'widthText']);
    expect(JSON.stringify(saved)).toBe(before);
  });
});

/* ───────────────────────── customer ───────────────────────── */

describe('toCustomerInfo', () => {
  const fields: FormFields = {
    name: '  علي حسن ',
    phone: '0770 123 4567',
    governorate: 'بغداد',
    district: '  الكرادة ',
    landmark: ' قرب الجامع  ',
    notes: ' اتصل قبل التوصيل ',
  };

  it('trims district, landmark, name and notes, and takes the validated phone, not the typed one', () => {
    expect(toCustomerInfo(fields, '9647701234567')).toStrictEqual({
      name: 'علي حسن',
      phone: '9647701234567',
      governorate: 'بغداد',
      district: 'الكرادة',
      landmark: 'قرب الجامع',
      notes: 'اتصل قبل التوصيل',
    });
  });

  it('turns an empty or blank name / notes into undefined (left out of the JSON body)', () => {
    const c = toCustomerInfo({ ...fields, name: '', notes: '   ' }, '9647701234567');
    expect(c.name).toBeUndefined();
    expect(c.notes).toBeUndefined();
    expect(JSON.stringify(c)).toBe('{"phone":"9647701234567","governorate":"بغداد","district":"الكرادة","landmark":"قرب الجامع"}');
  });

  it('keeps the key order of the request body: name, phone, governorate, district, landmark, notes', () => {
    expect(Object.keys(toCustomerInfo(fields, '9647701234567'))).toEqual(['name', 'phone', 'governorate', 'district', 'landmark', 'notes']);
    expect(JSON.stringify(toCustomerInfo(fields, '9647701234567'))).toBe(
      '{"name":"علي حسن","phone":"9647701234567","governorate":"بغداد","district":"الكرادة","landmark":"قرب الجامع","notes":"اتصل قبل التوصيل"}',
    );
  });

  it('does not trim or change the governorate', () => {
    expect(toCustomerInfo({ ...fields, governorate: ' البصرة ' }, '9647701234567').governorate).toBe(' البصرة ');
  });
});

describe('CUSTOMER_FIELD_IDS', () => {
  it('lists the validated fields in form order with their DOM ids', () => {
    expect(Object.entries(CUSTOMER_FIELD_IDS)).toEqual([
      ['phone', 'cust-phone'],
      ['governorate', 'cust-gov'],
      ['district', 'cust-district'],
      ['landmark', 'cust-landmark'],
    ]);
  });

  it('has an id for every field validateCustomer can flag', () => {
    const { errors } = validateCustomer({ name: '', phone: '', governorate: '', district: '', landmark: '', notes: '' });
    expect(Object.keys(errors).sort()).toEqual(Object.keys(CUSTOMER_FIELD_IDS).sort());
  });
});
