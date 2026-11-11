'use client';

import { sendTrack } from '@/lib/analytics/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { enabledMaterials, sheetsForStickers, validateStickers } from '@/lib/pricing';
import { decodeDesign } from '@/lib/design/decode.client';
import { logClient } from './logClient';
import {
  EMPTY_FIELDS,
  STEPS,
  buildSummary,
  dpiFor,
  dpiStatus,
  loadForm,
  parseStickers,
  pdfPrefillUm,
  restoredState,
  saveForm,
  stepStickers,
  stickersTextFor,
  validateCustomer,
  type CustomerErrors,
  type FormFields,
  type StepId,
} from './logic';
import { safeDerive, safeFormatCm, safeLayout, safeMaxWidth, safeParseCm, safePriceForStickers } from './safe';
import { useDebounced } from './useDebounced';
import type { Corners, DesignDecodeError, DesignSource, Material, Shape, ShopSettings, StickerSpec } from '@/lib/types';

type SizeUm = { widthUm: number; heightUm: number };

/** Object URL hygiene: revokes the previous URL when `url` changes, and the last one on unmount. */
function useRevokeObjectUrl(url: string | null): void {
  const urlRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = urlRef.current;
    if (prev && prev !== url) {
      try {
        URL.revokeObjectURL(prev);
      } catch {
        /* ignore */
      }
    }
    urlRef.current = url;
  }, [url]);
  useEffect(
    () => () => {
      if (urlRef.current) {
        try {
          URL.revokeObjectURL(urlRef.current);
        } catch {
          /* ignore */
        }
      }
    },
    [],
  );
}

/** Analytics: one 'step' event per step per session (still sent when sessionStorage throws). */
function useTrackStepOnce(stepName: StepId): void {
  useEffect(() => {
    try {
      const key = `softy-step-${stepName}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {}
    sendTrack({ type: 'step', step: stepName, path: window.location.pathname });
  }, [stepName]);
}

export function useBuilder(settings: ShopSettings) {
  const [step, setStep] = useState(0);
  const [shape, setShapeState] = useState<Shape | null>(null);
  const [corners, setCorners] = useState<Corners>('rounded');
  const [design, setDesign] = useState<DesignSource | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [designError, setDesignError] = useState<DesignDecodeError | null>(null);
  const [widthText, setWidthText] = useState('');
  const [heightText, setHeightText] = useState('');
  const [sizeUm, setSizeUm] = useState<SizeUm | null>(null);
  const [materialChoice, setMaterialChoice] = useState<Material | null>(null);
  // null = the customer never typed a count: the box shows the minimum for the current layout.
  const [typedStickers, setTypedStickers] = useState<string | null>(null);
  const [fields, setFields] = useState<FormFields>(EMPTY_FIELDS);
  const [showErrors, setShowErrors] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const lastFile = useRef<File | null>(null);
  const decodeToken = useRef(0);

  /* ── restore non-file state once on the client ── */
  useEffect(() => {
    const saved = loadForm();
    /* eslint-disable react-hooks/set-state-in-effect -- one-time restore after hydration */
    if (saved) {
      const r = restoredState(saved);
      if (r.shape !== undefined) setShapeState(r.shape);
      if (r.corners !== undefined) setCorners(r.corners);
      if (r.widthText !== undefined) setWidthText(r.widthText);
      if (r.heightText !== undefined) setHeightText(r.heightText);
      if (r.sizeUm !== undefined) setSizeUm(r.sizeUm);
      if (r.material !== undefined) setMaterialChoice(r.material);
      if (r.stickersText !== undefined) setTypedStickers(r.stickersText);
      setFields(r.fields);
    }
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!hydrated || !shape) return;
    saveForm({ shape, corners, widthText, heightText, sizeUm, material: materialChoice, stickersText: typedStickers ?? '', ...fields });
  }, [hydrated, shape, corners, widthText, heightText, sizeUm, materialChoice, typedStickers, fields]);

  useRevokeObjectUrl(design?.previewUrl ?? null);

  const aspect = design ? design.pxWidth / design.pxHeight : 1;

  /* ── size handling ── */
  /** Show a size in both inputs (a circle has no height field). */
  const showSize = useCallback((d: SizeUm, forShape: Shape) => {
    setSizeUm(d);
    setWidthText(safeFormatCm(d.widthUm));
    setHeightText(forShape === 'circle' ? '' : safeFormatCm(d.heightUm));
  }, []);

  const applySizeFromWidth = useCallback(
    (widthUm: number, forShape: Shape, forAspect: number) => showSize(safeDerive(forShape, forAspect, { widthUm }), forShape),
    [showSize],
  );

  const onWidthChange = useCallback(
    (text: string) => {
      setWidthText(text);
      const um = safeParseCm(text);
      if (!shape || !um) {
        setSizeUm(null);
        if (shape !== 'circle' && !text.trim()) setHeightText('');
        return;
      }
      const d = safeDerive(shape, aspect, { widthUm: um });
      setSizeUm(d);
      if (shape !== 'circle') setHeightText(safeFormatCm(d.heightUm));
    },
    [shape, aspect],
  );

  const onHeightChange = useCallback(
    (text: string) => {
      setHeightText(text);
      const um = safeParseCm(text);
      if (!shape || !um) {
        setSizeUm(null);
        if (!text.trim()) setWidthText('');
        return;
      }
      const d = safeDerive(shape, aspect, { heightUm: um });
      setSizeUm(d);
      setWidthText(safeFormatCm(d.widthUm));
    },
    [shape, aspect],
  );

  /* ── design decoding ── */
  const loadDesign = useCallback(
    async (file: File, forShape: Shape) => {
      const token = ++decodeToken.current;
      lastFile.current = file;
      setDecoding(true);
      setDesignError(null);
      let error: DesignDecodeError | null = null;
      let source: DesignSource | null = null;
      try {
        const out = await decodeDesign(file, { shape: forShape, maxBytes: settings.maxUploadBytes });
        if (out.ok) source = out.source;
        else error = out.error;
      } catch (e) {
        error = 'corrupt';
        logClient({ step: 'decode', message: e instanceof Error ? e.message : 'decode threw', fileType: file.type, fileSize: file.size });
      }
      if (token !== decodeToken.current) {
        // A newer decode superseded this one: drop its object URL.
        if (source) URL.revokeObjectURL(source.previewUrl);
        return;
      }
      setDecoding(false);
      if (!source) {
        if (error && error !== 'no_alpha') logClient({ step: 'decode', message: error, fileType: file.type, fileSize: file.size });
        setDesign(null);
        setDesignError(error);
        return;
      }
      setDesign(source);
      const prefill = pdfPrefillUm(source, forShape);
      if (prefill) {
        showSize(prefill, forShape);
      } else {
        const w = safeParseCm(widthText);
        if (w) applySizeFromWidth(w, forShape, source.pxWidth / source.pxHeight);
      }
    },
    [settings.maxUploadBytes, widthText, applySizeFromWidth, showSize],
  );

  const setShape = useCallback(
    (next: Shape) => {
      if (next === shape) return;
      const prev = shape;
      setShapeState(next);
      const w = safeParseCm(widthText);
      if (w) applySizeFromWidth(w, next, next === 'circle' ? 1 : aspect);
      // Only 'custom' changes how a file is decoded (alpha trim / alpha required).
      if ((next === 'custom' || prev === 'custom') && lastFile.current && (design || designError)) {
        void loadDesign(lastFile.current, next);
      }
    },
    [shape, widthText, aspect, applySizeFromWidth, design, designError, loadDesign],
  );

  const onFile = useCallback((file: File) => shape && loadDesign(file, shape), [shape, loadDesign]);

  /* ── derived: spec, layout, quality ── */
  const spec = useMemo<StickerSpec | null>(() => {
    if (!shape || !sizeUm) return null;
    return {
      shape,
      ...(shape === 'rect' ? { corners } : {}),
      widthUm: sizeUm.widthUm,
      heightUm: shape === 'circle' ? sizeUm.widthUm : sizeUm.heightUm,
    };
  }, [shape, corners, sizeUm]);

  const debouncedSpec = useDebounced(spec, 100);
  const outcome = useMemo(() => (debouncedSpec ? safeLayout(debouncedSpec, settings.layout) : null), [debouncedSpec, settings.layout]);
  const settled = debouncedSpec === spec;
  const layout = outcome && outcome.ok ? outcome.layout : null;

  const maxWidthUm = useMemo(() => {
    if (!shape) return null;
    const probe: StickerSpec = { shape, ...(shape === 'rect' ? { corners } : {}), widthUm: 50_000, heightUm: 50_000 };
    const m = safeMaxWidth(shape === 'circle' ? 1 : aspect, probe, settings.layout);
    return m && m > 0 ? m : null;
  }, [shape, corners, aspect, settings.layout]);

  const dpi = design && spec ? dpiFor(design, spec) : null;
  const dpiState = dpiStatus(dpi, settings.quality);

  /* ── quantity: material + sticker count (sheets and price are derived, never stored) ── */
  const pricing = settings.pricing;
  const materials = useMemo(() => enabledMaterials(pricing), [pricing]);
  // Chosen material if still enabled; otherwise paper (or the only/first enabled one).
  const material: Material | null =
    materialChoice && materials.includes(materialChoice) ? materialChoice : materials.includes('paper') ? 'paper' : (materials[0] ?? null);
  const countPerSheet = layout ? layout.countPerSheet : null;
  // What the box shows: the typed text, or (never typed) the minimum for the current layout.
  const stickersText = stickersTextFor(typedStickers, countPerSheet, pricing);
  const stickers = parseStickers(stickersText);
  const quantityError =
    material === null
      ? ('material_disabled' as const)
      : stickers === null
        ? ('not_integer' as const)
        : validateStickers(material, stickers, countPerSheet ?? 0, pricing);
  // Sheets are rounded up: the customer receives the whole last sheet.
  const sheets = stickers !== null && !quantityError && countPerSheet !== null ? sheetsForStickers(stickers, countPerSheet) : null;

  const setStickersText = setTypedStickers;
  /** Set an exact count (the quick picks); it counts as typed. */
  const setStickers = useCallback((n: number) => setTypedStickers(String(n)), []);
  /** The − / + buttons: one whole sheet of stickers up or down. */
  const stepSheet = useCallback(
    (dir: 1 | -1) => {
      if (countPerSheet === null) return;
      setTypedStickers((t) => String(stepStickers(parseStickers(stickersTextFor(t, countPerSheet, pricing)), dir, countPerSheet, pricing)));
    },
    [countPerSheet, pricing],
  );

  const price =
    material && stickers !== null && !quantityError && layout ? safePriceForStickers(material, stickers, layout.countPerSheet, settings) : null;
  const summary = spec && layout && price ? buildSummary(spec, layout, price) : null;

  const stepOk: Record<StepId, boolean> = {
    shape: shape !== null,
    design: design !== null && !decoding,
    size: !!layout && settled && dpiState !== 'block',
    quantity: !quantityError && !!layout,
    details: true,
  };

  const canGoTo = useCallback(
    (i: number) => {
      if (i <= step) return true;
      for (let k = 0; k < i; k++) if (!stepOk[STEPS[k]]) return false;
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step, stepOk.shape, stepOk.design, stepOk.size, stepOk.quantity],
  );
  const goTo = useCallback((i: number) => canGoTo(i) && setStep(Math.max(0, Math.min(STEPS.length - 1, i))), [canGoTo]);
  useTrackStepOnce(STEPS[step]);

  const next = useCallback(() => goTo(step + 1), [goTo, step]);
  const back = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

  /* ── customer ── */
  const setField = useCallback((key: keyof FormFields, value: string) => setFields((f) => ({ ...f, [key]: value })), []);
  const validation = useMemo(() => validateCustomer(fields), [fields]);
  const customerErrors: CustomerErrors = showErrors ? validation.errors : {};

  return {
    settings,
    step,
    stepId: STEPS[step],
    stepOk,
    canGoTo,
    goTo,
    next,
    back,
    shape,
    setShape,
    corners,
    setCorners,
    design,
    decoding,
    designError,
    onFile,
    widthText,
    heightText,
    onWidthChange,
    onHeightChange,
    spec,
    outcome: settled ? outcome : null,
    layout,
    maxWidthUm,
    dpi,
    dpiState,
    materials,
    material,
    setMaterial: setMaterialChoice,
    countPerSheet,
    stickers,
    stickersText,
    setStickersText,
    setStickers,
    stepSheet,
    sheets,
    quantityError,
    price,
    summary,
    fields,
    setField,
    validation,
    customerErrors,
    setShowErrors,
  };
}

export type BuilderApi = ReturnType<typeof useBuilder>;
