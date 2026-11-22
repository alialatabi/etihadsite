/**
 * Multi-design orders on the client: the slot reducer, the per-design rows, the layout of all designs together
 * (computeMultiLayout), the quantity rules working on countPerSheet = designs × copies, and the draft of the extras.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, MAX_DESIGNS } from '@/config/defaults';
import {
  DRAFT_KEY,
  FORM_KEY,
  buildSummary,
  loadDraft,
  restoredState,
  saveDraft,
  type PersistedForm,
} from '@/components/builder/logic';
import {
  allDesignsReady,
  anyDpiBlocked,
  buildMultiSpecs,
  designCount,
  designRows,
  designSizes,
  editHeight,
  editWidth,
  isMultiActive,
  perDesignTotal,
  roomLeft,
  savedExtras,
  sizeFromTexts,
  slotsReducer,
  specFor,
  splitPick,
  submitExtras,
  type DesignSlot,
} from '@/components/builder/multi-logic';
import { safeMultiLayout } from '@/components/builder/safe';
import { sheetsForStickers, validateStickers, minStickers, priceForStickers } from '@/lib/pricing';
import type { DesignSource, StickerSpec } from '@/lib/types';

const layoutSettings = DEFAULT_SETTINGS.layout;
const pricing = DEFAULT_SETTINGS.pricing;

const file = (name: string) => new File(['x'], name, { type: 'image/png', lastModified: 5 });
const art = (px = 600, py = 600, over: Partial<DesignSource> = {}): DesignSource =>
  ({ kind: 'png', file: file('a.png'), pxWidth: px, pxHeight: py, hasAlpha: false, previewUrl: 'blob:x', ...over }) as DesignSource;

const sizeEdit = (w: number, h: number) => ({ widthText: String(w / 10_000), heightText: String(h / 10_000), sizeUm: { widthUm: w, heightUm: h } });

function slot(id: string, over: Partial<DesignSlot> = {}): DesignSlot {
  return { id, file: file(`${id}.png`), design: art(), decoding: false, error: null, widthText: '3', heightText: '3', sizeUm: { widthUm: 30_000, heightUm: 30_000 }, fileId: `f-${id}`, ...over };
}

describe('isMultiActive', () => {
  it('needs the upload mode, the box ticked and at least one extra', () => {
    expect(isMultiActive('upload', true, 1)).toBe(true);
    expect(isMultiActive('upload', true, 0)).toBe(false); // ticked but nothing added: behaves as single
    expect(isMultiActive('upload', false, 3)).toBe(false);
    expect(isMultiActive('ai', true, 3)).toBe(false); // AI mode is never multi
  });
});

describe('slotsReducer', () => {
  it('start adds a slot being read, reads an existing one again, and stops at the cap', () => {
    let s = slotsReducer([], { type: 'start', id: 'a', file: file('a.png') });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ id: 'a', decoding: true, design: null, error: null, fileId: null });

    s = slotsReducer(s, { type: 'decoded', id: 'a', design: art(), fileId: 'fa', size: sizeEdit(30_000, 30_000) });
    const again = slotsReducer(s, { type: 'start', id: 'a', file: file('b.png') });
    expect(again).toHaveLength(1);
    expect(again[0].design).not.toBeNull(); // the old design stays until the new one is read
    expect(again[0]).toMatchObject({ decoding: true, error: null });
    expect(again[0].file?.name).toBe('b.png');

    let full: DesignSlot[] = [];
    for (let i = 0; i < MAX_DESIGNS + 3; i++) full = slotsReducer(full, { type: 'start', id: `s${i}`, file: file('x.png') });
    expect(full).toHaveLength(MAX_DESIGNS - 1); // design 1 is the eighth
  });

  it('decoded stores the design, its file id and its size; failed keeps the file for another try', () => {
    let s = slotsReducer([], { type: 'start', id: 'a', file: file('a.png') });
    s = slotsReducer(s, { type: 'decoded', id: 'a', design: art(), fileId: 'fa', size: sizeEdit(40_000, 20_000) });
    expect(s[0]).toMatchObject({ decoding: false, fileId: 'fa', widthText: '4', heightText: '2', sizeUm: { widthUm: 40_000, heightUm: 20_000 } });
    s = slotsReducer(s, { type: 'failed', id: 'a', error: 'no_alpha' });
    expect(s[0]).toMatchObject({ design: null, decoding: false, error: 'no_alpha', fileId: null });
    expect(s[0].file).not.toBeNull();
  });

  it('remove, size, reset and dropUndecoded', () => {
    const base = [slot('a'), slot('b', { design: null, decoding: true }), slot('c', { design: null, error: 'corrupt' })];
    expect(slotsReducer(base, { type: 'remove', id: 'a' }).map((s) => s.id)).toEqual(['b', 'c']);
    expect(slotsReducer(base, { type: 'size', id: 'a', size: sizeEdit(50_000, 50_000) })[0].sizeUm).toEqual({ widthUm: 50_000, heightUm: 50_000 });
    expect(slotsReducer(base, { type: 'dropUndecoded' }).map((s) => s.id)).toEqual(['a', 'c']); // only a read in flight goes
    expect(slotsReducer(base, { type: 'reset' })).toEqual([]);
    const empty: DesignSlot[] = [];
    expect(slotsReducer(empty, { type: 'reset' })).toBe(empty);
  });

  it('reshape derives each size again from its typed width and its own aspect', () => {
    const wide = slot('w', { design: art(800, 400), widthText: '4', heightText: '2', sizeUm: { widthUm: 40_000, heightUm: 20_000 } });
    const [asCircle] = slotsReducer([wide], { type: 'reshape', shape: 'circle' });
    expect(asCircle.sizeUm).toEqual({ widthUm: 40_000, heightUm: 40_000 });
    expect(asCircle.heightText).toBe('');
    const [asRect] = slotsReducer([asCircle], { type: 'reshape', shape: 'rect' });
    expect(asRect.sizeUm).toEqual({ widthUm: 40_000, heightUm: 20_000 });
    // a slot without a design is left alone
    const noArt = slot('n', { design: null });
    expect(slotsReducer([noArt], { type: 'reshape', shape: 'rect' })[0]).toBe(noArt);
  });
});

describe('size of an extra design', () => {
  it('width edit: the height follows the design\'s own aspect (locked), a circle keeps one side', () => {
    expect(editWidth('rect', 2, '4', '')).toEqual({ widthText: '4', heightText: '2', sizeUm: { widthUm: 40_000, heightUm: 20_000 } });
    expect(editWidth('rect', 0.5, '4', '')).toMatchObject({ heightText: '8', sizeUm: { widthUm: 40_000, heightUm: 80_000 } });
    expect(editWidth('circle', 2, '3', '')).toMatchObject({ heightText: '', sizeUm: { widthUm: 30_000, heightUm: 30_000 } });
    expect(editWidth('rect', 2, 'abc', '7')).toEqual({ widthText: 'abc', heightText: '7', sizeUm: null });
    expect(editWidth('rect', 2, '', '7')).toEqual({ widthText: '', heightText: '', sizeUm: null });
  });

  it('height edit mirrors it', () => {
    expect(editHeight('rect', 2, '2', '')).toEqual({ widthText: '4', heightText: '2', sizeUm: { widthUm: 40_000, heightUm: 20_000 } });
    expect(editHeight('rect', 2, '', '4')).toEqual({ widthText: '', heightText: '', sizeUm: null });
  });

  it('sizeFromTexts: the typed width (else height) and the artwork give the size; junk gives null', () => {
    expect(sizeFromTexts('rect', 2, '4', '')).toEqual({ widthUm: 40_000, heightUm: 20_000 });
    expect(sizeFromTexts('rect', 2, '', '2')).toEqual({ widthUm: 40_000, heightUm: 20_000 });
    expect(sizeFromTexts('circle', 2, '3', '')).toEqual({ widthUm: 30_000, heightUm: 30_000 });
    expect(sizeFromTexts('rect', 2, 'x', 'y')).toBeNull();
  });
});

describe('specs and the layout of all designs together', () => {
  const first: StickerSpec = { shape: 'rect', corners: 'rounded', widthUm: 40_000, heightUm: 30_000 };

  it('buildMultiSpecs: design 1 first, every other design its own size, null while one has none', () => {
    const specs = buildMultiSpecs(first, 'rect', 'rounded', [{ widthUm: 50_000, heightUm: 20_000 }, { widthUm: 30_000, heightUm: 30_000 }])!;
    expect(specs).toHaveLength(3);
    expect(specs[0]).toBe(first);
    expect(specs[1]).toEqual({ shape: 'rect', corners: 'rounded', widthUm: 50_000, heightUm: 20_000 });
    expect(buildMultiSpecs(first, 'rect', 'rounded', [null])).toBeNull();
    expect(buildMultiSpecs(null, 'rect', 'rounded', [])).toBeNull();
    // a circle has one side, and no corners
    expect(specFor('circle', 'rounded', { widthUm: 30_000, heightUm: 99 })).toEqual({ shape: 'circle', widthUm: 30_000, heightUm: 30_000 });
  });

  it('computeMultiLayout through safeMultiLayout: N designs × k copies of each, countPerSheet = N·k', () => {
    const specs = buildMultiSpecs(first, 'rect', 'rounded', [{ widthUm: 30_000, heightUm: 30_000 }, { widthUm: 50_000, heightUm: 25_000 }])!;
    const out = safeMultiLayout(specs, layoutSettings);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const { layout } = out;
    expect(layout.designs).toHaveLength(3);
    expect(layout.countPerSheet).toBe(3 * layout.perDesign);
    expect(layout.placements).toHaveLength(layout.countPerSheet);
    for (let d = 0; d < 3; d++) expect(layout.placements.filter((p) => p.designIndex === d)).toHaveLength(layout.perDesign);
    // each design keeps its own cell size
    expect(layout.designs.map((d) => d.cell)).toEqual([
      { widthUm: 40_000, heightUm: 30_000 },
      { widthUm: 30_000, heightUm: 30_000 },
      { widthUm: 50_000, heightUm: 25_000 },
    ]);
  });

  it('a design that does not fit alone is named by designIndex; designs that only fit apart come back without one', () => {
    const tooBig = safeMultiLayout([first, { shape: 'rect', corners: 'rounded', widthUm: 400_000, heightUm: 300_000 }], layoutSettings);
    expect(tooBig).toMatchObject({ ok: false, designIndex: 1 });

    // three designs that each fit alone, but not three together (copies of each: at least one)
    const huge: StickerSpec = { shape: 'rect', corners: 'sharp', widthUm: 190_000, heightUm: 270_000 };
    const together = safeMultiLayout([huge, huge, huge], layoutSettings);
    expect(together.ok).toBe(false);
    if (!together.ok) expect(together.designIndex).toBeUndefined();
  });

  it('never throws', () => {
    expect(() => safeMultiLayout([], layoutSettings)).not.toThrow();
    expect(safeMultiLayout([], layoutSettings).ok).toBe(false);
    expect(safeMultiLayout(null as never, layoutSettings).ok).toBe(false);
  });
});

describe('quantity: one total count, equal split', () => {
  const specs: StickerSpec[] = [
    { shape: 'circle', widthUm: 30_000, heightUm: 30_000 },
    { shape: 'circle', widthUm: 40_000, heightUm: 40_000 },
  ];

  it('the existing pricing rules work on countPerSheet = N·k unchanged; each design gets sheets × k', () => {
    const out = safeMultiLayout(specs, layoutSettings);
    if (!out.ok) throw new Error('layout');
    const { layout } = out;
    const cps = layout.countPerSheet;
    expect(cps).toBe(2 * layout.perDesign);

    const min = minStickers(cps, pricing);
    expect(min).toBe(pricing.minSheets * cps); // min = minSheets × countPerSheet
    expect(validateStickers('paper', min, cps, pricing)).toBeNull();

    const typed = min + 1;
    const sheets = sheetsForStickers(typed, cps);
    expect(sheets).toBe(Math.ceil(typed / cps));
    // each design is received sheets × k times
    expect(perDesignTotal(sheets, layout)).toBe(sheets * layout.perDesign);
    expect(perDesignTotal(sheets, layout)! * 2).toBe(sheets * cps);
    expect(perDesignTotal(null, layout)).toBeNull();
    expect(perDesignTotal(sheets, null)).toBeNull();
  });

  it('the price is the price of countPerSheet stickers per sheet (nothing multi-specific)', () => {
    const out = safeMultiLayout(specs, layoutSettings);
    if (!out.ok) throw new Error('layout');
    const cps = out.layout.countPerSheet;
    const stickers = minStickers(cps, pricing);
    const p = priceForStickers('paper', stickers, cps, DEFAULT_SETTINGS);
    expect(p.sheets).toBe(sheetsForStickers(stickers, cps));
    expect(p.totalStickers).toBe(p.sheets * cps);
  });

  it('buildSummary: a single-design summary is exactly as before; multi adds designs and perDesign only', () => {
    const spec = specs[0];
    const out = safeMultiLayout(specs, layoutSettings);
    if (!out.ok) throw new Error('layout');
    const cps = out.layout.countPerSheet;
    const price = priceForStickers('paper', minStickers(cps, pricing), cps, DEFAULT_SETTINGS);
    const single = buildSummary(spec, { countPerSheet: cps }, price);
    expect('designs' in single).toBe(false);
    expect('perDesign' in single).toBe(false);
    const multi = buildSummary(spec, { countPerSheet: cps }, price, { designs: designSizes(specs), perDesign: out.layout.perDesign });
    expect(multi.designs).toEqual([
      { widthUm: 30_000, heightUm: 30_000 },
      { widthUm: 40_000, heightUm: 40_000 },
    ]);
    expect(multi.perDesign).toBe(out.layout.perDesign);
    const rest: Record<string, unknown> = { ...multi };
    delete rest.designs;
    delete rest.perDesign;
    expect(rest).toEqual(single);
  });
});

describe('rows and the step gates', () => {
  const quality = DEFAULT_SETTINGS.quality;
  const base = {
    shape: 'rect' as const,
    corners: 'rounded' as const,
    design: art(),
    decoding: false,
    designError: null,
    widthText: '3',
    heightText: '3',
    spec: { shape: 'rect', corners: 'rounded', widthUm: 30_000, heightUm: 30_000 } as StickerSpec,
    quality,
  };

  it('design 1 first, then one row per extra, each with its own spec', () => {
    const rows = designRows({ ...base, extras: [slot('b', { sizeUm: { widthUm: 50_000, heightUm: 25_000 } })], maxWidths: [200_000, 180_000] });
    expect(rows.map((r) => [r.index, r.id])).toEqual([[0, 'main'], [1, 'b']]);
    expect(rows[1].spec).toEqual({ shape: 'rect', corners: 'rounded', widthUm: 50_000, heightUm: 25_000 });
    expect(rows.map((r) => r.maxWidthUm)).toEqual([200_000, 180_000]);
  });

  it('every design must be read, error-free and not being read (design step gate)', () => {
    const ok = designRows({ ...base, extras: [slot('b')], maxWidths: [1, 1] });
    expect(allDesignsReady(ok)).toBe(true);
    expect(allDesignsReady(designRows({ ...base, extras: [slot('b', { decoding: true })], maxWidths: [1, 1] }))).toBe(false);
    expect(allDesignsReady(designRows({ ...base, extras: [slot('b', { design: null, error: 'no_alpha' })], maxWidths: [1, 1] }))).toBe(false);
    expect(allDesignsReady(designRows({ ...base, design: null, extras: [slot('b')], maxWidths: [1, 1] }))).toBe(false);
    expect(allDesignsReady([])).toBe(false);
  });

  it('a design below the blocking DPI blocks the size step, even when design 1 is fine (size step gate)', () => {
    // 20 px over 3 cm is far below any printable resolution
    const blurry = slot('b', { design: art(20, 20) });
    const rows = designRows({ ...base, extras: [blurry], maxWidths: [1, 1] });
    expect(rows[0].dpiState).toBe('ok');
    expect(rows[1].dpiState).toBe('block');
    expect(anyDpiBlocked(rows)).toBe(true);
    expect(anyDpiBlocked(designRows({ ...base, extras: [slot('b')], maxWidths: [1, 1] }))).toBe(false);
  });
});

describe('picking files', () => {
  const f = (n: number) => Array.from({ length: n }, (_, i) => file(`f${i}.png`));

  it('the first file is design 1 while it is empty, the rest are extras', () => {
    const r = splitPick(f(3), false, 0);
    expect(r.first?.name).toBe('f0.png');
    expect(r.extras.map((x) => x.name)).toEqual(['f1.png', 'f2.png']);
    expect(r.ignored).toBe(0);
  });

  it('with design 1 taken every file is an extra', () => {
    const r = splitPick(f(2), true, 1);
    expect(r.first).toBeNull();
    expect(r.extras).toHaveLength(2);
  });

  it('files beyond MAX_DESIGNS are ignored and counted', () => {
    const r = splitPick(f(12), false, 0);
    expect(1 + r.extras.length).toBe(MAX_DESIGNS);
    expect(r.ignored).toBe(12 - MAX_DESIGNS);
    const full = splitPick(f(2), true, MAX_DESIGNS - 1);
    expect(full.extras).toEqual([]);
    expect(full.ignored).toBe(2);
  });

  it('designCount / roomLeft', () => {
    expect(designCount(true, 2)).toBe(3);
    expect(designCount(false, 0)).toBe(0);
    expect(roomLeft(true, MAX_DESIGNS - 1)).toBe(0);
    expect(roomLeft(true, 100)).toBe(0);
  });
});

describe('submit extras and saved extras', () => {
  it('submitExtras gives each extra its own size (a circle: equal sides) and null while one is incomplete', () => {
    const a = slot('a', { sizeUm: { widthUm: 50_000, heightUm: 20_000 } });
    expect(submitExtras([a], 'rect')).toEqual([{ design: a.design, widthUm: 50_000, heightUm: 20_000 }]);
    expect(submitExtras([a], 'circle')).toEqual([{ design: a.design, widthUm: 50_000, heightUm: 50_000 }]);
    expect(submitExtras([slot('b', { sizeUm: null })], 'rect')).toBeNull();
    expect(submitExtras([slot('b', { design: null })], 'rect')).toBeNull();
    expect(submitExtras([], 'rect')).toEqual([]);
  });

  it('savedExtras keeps only designs that are read and saved, with their typed sizes', () => {
    const list = [slot('a', { widthText: '4', heightText: '2' }), slot('b', { fileId: null }), slot('c', { design: null }), slot('d', { widthText: '6', heightText: '' })];
    expect(savedExtras(list)).toEqual([
      { fileId: 'f-a', widthText: '4', heightText: '2' },
      { fileId: 'f-d', widthText: '6', heightText: '' },
    ]);
  });
});

/* ───────────────────────── the draft ───────────────────────── */

const FORM: PersistedForm = {
  shape: 'rect',
  corners: 'rounded',
  widthText: '3',
  heightText: '3',
  sizeUm: { widthUm: 30_000, heightUm: 30_000 },
  material: 'paper',
  stickersText: '',
  name: '',
  phone: '',
  governorate: '',
  district: '',
  landmark: '',
  notes: '',
  step: 2,
  fileId: 'main1',
  mode: 'upload',
};

function fakeStorage() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe('the draft with extra designs', () => {
  afterEach(() => vi.unstubAllGlobals());

  const withStorage = () => {
    const local = fakeStorage();
    const session = fakeStorage();
    vi.stubGlobal('window', { localStorage: local, sessionStorage: session });
    return { local, session };
  };

  it('a single-design draft is saved exactly as before: no `multi` key anywhere', () => {
    const { local, session } = withStorage();
    saveDraft(FORM, 1000);
    expect(local.m.get(DRAFT_KEY)).toBe(JSON.stringify({ v: 1, savedAt: 1000, form: { ...FORM, name: '', phone: '', governorate: '', district: '', landmark: '', notes: '' } }));
    expect(session.m.get(FORM_KEY)).toBe(JSON.stringify(FORM));
    expect(local.m.get(DRAFT_KEY)).not.toContain('multi');
  });

  it('a multi-design draft keeps the extras (file id and typed sizes) through save and load', () => {
    withStorage();
    const multi = { extras: [{ fileId: 'x1', widthText: '4', heightText: '2' }, { fileId: 'x2', widthText: '5', heightText: '' }] };
    saveDraft({ ...FORM, multi }, 1000);
    expect(loadDraft(1000)?.multi).toEqual(multi);
    expect(restoredState(loadDraft(1000)!).multi).toEqual(multi);
  });

  it('restoredState has no `multi` key for a single-design draft, and drops junk', () => {
    expect('multi' in restoredState(FORM)).toBe(false);
    expect('multi' in restoredState({ ...FORM, multi: 'x' as never })).toBe(false);
    expect('multi' in restoredState({ ...FORM, multi: { extras: [] } })).toBe(false);
    expect('multi' in restoredState({ ...FORM, multi: { extras: [{ fileId: '' } as never, null as never, { fileId: 9 } as never] } })).toBe(false);
  });

  it('restoredState validates each extra: ids, text length, duplicates and the cap', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ fileId: `id${i}`, widthText: '3', heightText: '3' }));
    const r = restoredState({ ...FORM, multi: { extras: [{ fileId: 'a', widthText: 5 as never, heightText: 'x'.repeat(100) }, { fileId: 'a', widthText: '1', heightText: '1' }, ...many] } });
    expect(r.multi!.extras).toHaveLength(MAX_DESIGNS - 1);
    expect(r.multi!.extras[0]).toEqual({ fileId: 'a', widthText: '', heightText: 'x'.repeat(32) });
    expect(r.multi!.extras.filter((e) => e.fileId === 'a')).toHaveLength(1);
    expect(r.multi!.extras.every((e) => e.fileId.length <= 64)).toBe(true);
    expect(restoredState({ ...FORM, multi: { extras: [{ fileId: 'y'.repeat(65), widthText: '1', heightText: '1' }] } }).multi).toBeUndefined();
  });
});
