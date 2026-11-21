import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DRAFT_KEY,
  DRAFT_TTL_MS,
  FORM_KEY,
  STEPS,
  clampStep,
  clearDraft,
  furthestStep,
  isDraftExpired,
  withoutPersonal,
  EMPTY_FIELDS,
  loadDraft,
  parseDraft,
  restoredState,
  saveDraft,
  type PersistedForm,
  type StepId,
} from '@/components/builder/logic';
import { clearDraftFile, draftFileFrom, loadDraftFile, saveDraftFile } from '@/components/builder/draft-store';

const NOW = 1_800_000_000_000;
const FORM: PersistedForm = {
  shape: 'circle',
  corners: 'rounded',
  widthText: '3',
  heightText: '',
  sizeUm: { widthUm: 30_000, heightUm: 30_000 },
  material: 'plastic',
  stickersText: '1050',
  name: '',
  phone: '07701234567',
  governorate: 'بغداد',
  district: 'الكرادة',
  landmark: 'قرب الجامع',
  notes: '',
  step: 3,
  fileId: 'abc123',
};

const ok = (done: number): Record<StepId, boolean> =>
  Object.fromEntries(STEPS.map((id, i) => [id, i < done])) as Record<StepId, boolean>;

describe('furthestStep / clampStep', () => {
  it('furthest is the first step that is not done, and never past the last step', () => {
    expect(furthestStep(ok(0))).toBe(0);
    expect(furthestStep(ok(2))).toBe(2);
    expect(furthestStep(ok(4))).toBe(4);
    expect(furthestStep(ok(5))).toBe(STEPS.length - 1);
  });

  it('a gap stops it: later steps that happen to be ok do not count', () => {
    const o = { ...ok(5), design: false };
    expect(furthestStep(o)).toBe(1);
  });

  it('clamps the saved step to the furthest allowed one', () => {
    expect(clampStep(3, 5)).toBe(3);
    expect(clampStep(3, 1)).toBe(1);
    expect(clampStep(4, 4)).toBe(4);
    expect(clampStep(0, 4)).toBe(0);
  });

  it('junk saved steps open the first step', () => {
    for (const bad of [undefined, null, '2', 1.5, NaN, Infinity, {}, [2]]) expect(clampStep(bad, 4)).toBe(0);
    expect(clampStep(-3, 4)).toBe(0);
    expect(clampStep(99, 99)).toBe(STEPS.length - 1);
  });
});

describe('restoredState with a step', () => {
  it('accepts a valid step index', () => {
    expect(restoredState({ ...FORM, step: 3 }).step).toBe(3);
    expect(restoredState({ step: 0 }).step).toBe(0);
    expect(restoredState({ step: STEPS.length - 1 }).step).toBe(STEPS.length - 1);
  });

  it('an old saved form without a step still loads, with no step key', () => {
    const old: PersistedForm = { ...FORM };
    delete old.step;
    const r = restoredState(old);
    expect('step' in r).toBe(false);
    expect(r.shape).toBe('circle');
    expect(r.stickersText).toBe('1050');
  });

  it('accepts a file id and rejects junk ones', () => {
    expect(restoredState({ fileId: 'abc123' }).fileId).toBe('abc123');
    for (const bad of ['', 42, null, 'x'.repeat(65)]) expect('fileId' in restoredState({ fileId: bad as unknown as string })).toBe(false);
  });

  it('rejects an out-of-range, fractional or non-number step', () => {
    for (const bad of [-1, STEPS.length, 2.5, '3', null, NaN]) {
      expect('step' in restoredState({ step: bad as unknown as number })).toBe(false);
    }
  });
});

describe('draft expiry', () => {
  it('keeps a draft for 2 hours (owner decision 2026-11-21)', () => {
    expect(DRAFT_TTL_MS).toBe(2 * 60 * 60 * 1000);
    expect(isDraftExpired(NOW - (2 * 60 - 1) * 60 * 1000, NOW)).toBe(false);
    expect(isDraftExpired(NOW - (2 * 60 + 1) * 60 * 1000, NOW)).toBe(true);
  });

  it('fresh, exactly at the limit, and past it', () => {
    expect(isDraftExpired(NOW - 1000, NOW)).toBe(false);
    expect(isDraftExpired(NOW - DRAFT_TTL_MS, NOW)).toBe(false);
    expect(isDraftExpired(NOW - DRAFT_TTL_MS - 1, NOW)).toBe(true);
  });

  it('a missing or unreadable timestamp is expired', () => {
    for (const bad of [undefined, null, 'x', NaN, Infinity]) expect(isDraftExpired(bad, NOW)).toBe(true);
  });

  it('a timestamp far in the future (clock jump) is expired too', () => {
    expect(isDraftExpired(NOW + DRAFT_TTL_MS + 1, NOW)).toBe(true);
  });

  it('parseDraft returns the form when fresh', () => {
    const raw = JSON.stringify({ v: 1, savedAt: NOW - 5000, form: FORM });
    expect(parseDraft(raw, NOW)).toEqual({ form: FORM, expired: false });
  });

  it('parseDraft flags an old envelope as expired and gives no form', () => {
    const raw = JSON.stringify({ v: 1, savedAt: NOW - DRAFT_TTL_MS - 1, form: FORM });
    expect(parseDraft(raw, NOW)).toEqual({ form: null, expired: true });
  });

  it('parseDraft tolerates junk', () => {
    for (const raw of [null, undefined, '', '{nope', 'null', '42', '"x"', '[1]']) {
      expect(parseDraft(raw, NOW).form).toBeNull();
    }
    expect(parseDraft(JSON.stringify({ savedAt: NOW, form: [1] }), NOW).form).toBeNull();
    expect(parseDraft(JSON.stringify({ savedAt: NOW, form: 'x' }), NOW).form).toBeNull();
    expect(parseDraft(JSON.stringify({ form: FORM }), NOW)).toEqual({ form: null, expired: true });
  });
});

function fakeStorage(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('saveDraft / loadDraft / clearDraft', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('writes the order (without personal fields) to localStorage and the full form to sessionStorage', () => {
    const local = fakeStorage();
    const session = fakeStorage();
    vi.stubGlobal('window', { localStorage: local, sessionStorage: session });
    saveDraft(FORM, NOW);
    const env = JSON.parse(local.data.get(DRAFT_KEY)!);
    expect(env).toEqual({ v: 1, savedAt: NOW, form: withoutPersonal(FORM) });
    for (const k of Object.keys(EMPTY_FIELDS)) expect(env.form[k]).toBe('');
    expect(local.data.get(DRAFT_KEY)).not.toContain('07701234567');
    expect(JSON.parse(session.data.get(FORM_KEY)!)).toEqual(FORM);
    expect(loadDraft(NOW + 1000)).toEqual(FORM);
  });

  it('never stores the WhatsApp-offers opt-in: neither storage mentions it, so it cannot come back pre-ticked', () => {
    const local = fakeStorage();
    const session = fakeStorage();
    vi.stubGlobal('window', { localStorage: local, sessionStorage: session });
    saveDraft(FORM, NOW);
    expect(local.data.get(DRAFT_KEY)).not.toMatch(/marketing/i);
    expect(session.data.get(FORM_KEY)).not.toMatch(/marketing/i);
    expect(Object.keys(EMPTY_FIELDS)).not.toContain('marketingOptIn');
  });

  it('a new tab (empty sessionStorage) gets the order back but not the personal fields', () => {
    const local = fakeStorage();
    vi.stubGlobal('window', { localStorage: local, sessionStorage: fakeStorage() });
    saveDraft(FORM, NOW);
    vi.stubGlobal('window', { localStorage: local, sessionStorage: fakeStorage() });
    expect(loadDraft(NOW + 1000)).toEqual(withoutPersonal(FORM));
    expect(loadDraft(NOW + 1000)?.shape).toBe('circle');
  });

  it('reads an old sessionStorage-only form (saved before this change)', () => {
    const old: PersistedForm = { ...FORM };
    delete old.step;
    vi.stubGlobal('window', { localStorage: fakeStorage(), sessionStorage: fakeStorage({ [FORM_KEY]: JSON.stringify(old) }) });
    expect(loadDraft(NOW)).toEqual(old);
  });

  it('works with sessionStorage only (localStorage blocked)', () => {
    const session = fakeStorage();
    vi.stubGlobal('window', {
      sessionStorage: session,
      get localStorage(): never {
        throw new Error('blocked');
      },
    });
    saveDraft(FORM, NOW);
    expect(loadDraft(NOW)).toEqual(FORM);
  });

  it('an expired localStorage draft is deleted from both storages and not returned', () => {
    const local = fakeStorage({ [DRAFT_KEY]: JSON.stringify({ v: 1, savedAt: NOW - DRAFT_TTL_MS - 5, form: FORM }) });
    const session = fakeStorage({ [FORM_KEY]: JSON.stringify(FORM) });
    vi.stubGlobal('window', { localStorage: local, sessionStorage: session });
    expect(loadDraft(NOW)).toBeNull();
    expect(local.data.size).toBe(0);
    expect(session.data.size).toBe(0);
  });

  it('clearDraft removes both', () => {
    const local = fakeStorage();
    const session = fakeStorage();
    vi.stubGlobal('window', { localStorage: local, sessionStorage: session });
    saveDraft(FORM, NOW);
    clearDraft();
    expect(local.data.size + session.data.size).toBe(0);
    expect(loadDraft(NOW)).toBeNull();
  });

  it('throwing storages never propagate', () => {
    const boom = () => {
      throw new Error('quota');
    };
    const bad = { getItem: boom, setItem: boom, removeItem: boom };
    vi.stubGlobal('window', { localStorage: bad, sessionStorage: bad });
    expect(() => saveDraft(FORM, NOW)).not.toThrow();
    expect(loadDraft(NOW)).toBeNull();
    expect(() => clearDraft()).not.toThrow();
  });

  it('without a window everything is a no-op', () => {
    expect(() => saveDraft(FORM, NOW)).not.toThrow();
    expect(loadDraft(NOW)).toBeNull();
    expect(() => clearDraft()).not.toThrow();
  });
});

describe('draft-store without IndexedDB', () => {
  afterEach(() => vi.unstubAllGlobals());

  const file = new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png', lastModified: 123 });

  it('Node has no indexedDB: save and clear resolve, load answers null', async () => {
    expect(typeof indexedDB).toBe('undefined');
    await expect(saveDraftFile(file, 'abc123')).resolves.toBeUndefined();
    await expect(loadDraftFile()).resolves.toBeNull();
    await expect(clearDraftFile()).resolves.toBeUndefined();
    await expect(clearDraftFile('abc123')).resolves.toBeUndefined();
  });

  it('an indexedDB that throws is swallowed', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('SecurityError');
      },
    });
    await expect(saveDraftFile(file, 'abc123')).resolves.toBeUndefined();
    await expect(loadDraftFile()).resolves.toBeNull();
    await expect(clearDraftFile()).resolves.toBeUndefined();
  });

  it('an indexedDB that never answers gives up after the open timeout', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('indexedDB', { open: () => ({}) });
      const p = loadDraftFile();
      await vi.advanceTimersByTimeAsync(3500);
      await expect(p).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('an indexedDB whose open fails answers null', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        const req: { onerror?: () => void } = {};
        queueMicrotask(() => req.onerror?.());
        return req;
      },
    });
    await expect(loadDraftFile()).resolves.toBeNull();
  });

  it('draftFileFrom rebuilds the file with its id and refuses junk records', async () => {
    const rec = { id: 'abc123', blob: file, name: 'logo.png', type: 'image/png', lastModified: 123, savedAt: NOW - 1000 };
    const d = draftFileFrom(rec, NOW)!;
    expect(d.id).toBe('abc123');
    expect(d.file).toBeInstanceOf(File);
    expect([d.file.name, d.file.type, d.file.lastModified, d.file.size]).toEqual(['logo.png', 'image/png', 123, 3]);
    for (const bad of [null, undefined, 'x', 42, {}, { blob: 'nope', savedAt: NOW, id: 'a' }]) expect(draftFileFrom(bad, NOW)).toBeNull();
    // a record without an id (not written by this code) is not trusted
    expect(draftFileFrom({ ...rec, id: undefined }, NOW)).toBeNull();
  });

  it('a stored file has its own 7-day limit', () => {
    const rec = { id: 'a', blob: file, name: 'logo.png', type: 'image/png', lastModified: 1, savedAt: NOW - DRAFT_TTL_MS };
    expect(draftFileFrom(rec, NOW)).not.toBeNull();
    expect(draftFileFrom({ ...rec, savedAt: NOW - DRAFT_TTL_MS - 1 }, NOW)).toBeNull();
    expect(draftFileFrom({ ...rec, savedAt: undefined }, NOW)).toBeNull();
  });
});
