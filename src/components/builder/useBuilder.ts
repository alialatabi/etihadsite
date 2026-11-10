'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { enabledMaterials, validateQuantity } from '@/lib/pricing';
import { decodeDesign } from '@/lib/design/decode.client';
import { logClient } from './logClient';
import {
  EMPTY_FIELDS,
  STEPS,
  buildSummary,
  clampSheets,
  dpiFor,
  dpiStatus,
  loadForm,
  parseSheets,
  pdfPrefillUm,
  saveForm,
  validateCustomer,
  type CustomerErrors,
  type FormFields,
  type StepId,
} from './logic';
import { safeDerive, safeFormatCm, safeLayout, safeMaxWidth, safeParseCm, safePrice } from './safe';
import type { Corners, DesignDecodeError, DesignSource, Material, Shape, ShopSettings, StickerSpec } from '@/lib/types';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type SizeUm = { widthUm: number; heightUm: number };

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
  const [sheetsText, setSheetsText] = useState(() => String(settings.pricing.minSheets));
  const [fields, setFields] = useState<FormFields>(EMPTY_FIELDS);
  const [showErrors, setShowErrors] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const lastFile = useRef<File | null>(null);
  const decodeToken = useRef(0);
  const urlRef = useRef<string | null>(null);

  /* ── restore non-file state once on the client ── */
  useEffect(() => {
    const saved = loadForm();
    /* eslint-disable react-hooks/set-state-in-effect -- one-time restore after hydration */
    if (saved) {
      if (saved.shape) setShapeState(saved.shape);
      if (saved.corners) setCorners(saved.corners);
      if (typeof saved.widthText === 'string') setWidthText(saved.widthText);
      if (typeof saved.heightText === 'string') setHeightText(saved.heightText);
      if (saved.sizeUm) setSizeUm(saved.sizeUm);
      if (saved.material === 'paper' || saved.material === 'plastic') setMaterialChoice(saved.material);
      if (typeof saved.sheetsText === 'string' && saved.sheetsText.trim()) setSheetsText(saved.sheetsText);
      setFields({
        name: saved.name ?? '',
        phone: saved.phone ?? '',
        governorate: saved.governorate ?? '',
        district: saved.district ?? '',
        landmark: saved.landmark ?? '',
        notes: saved.notes ?? '',
      });
    }
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!hydrated || !shape) return;
    saveForm({ shape, corners, widthText, heightText, sizeUm, material: materialChoice, sheetsText, ...fields });
  }, [hydrated, shape, corners, widthText, heightText, sizeUm, materialChoice, sheetsText, fields]);

  /* ── object URL hygiene ── */
  useEffect(() => {
    const url = design?.previewUrl ?? null;
    const prev = urlRef.current;
    if (prev && prev !== url) {
      try {
        URL.revokeObjectURL(prev);
      } catch {
        /* ignore */
      }
    }
    urlRef.current = url;
  }, [design]);
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

  const aspect = design ? design.pxWidth / design.pxHeight : 1;

  /* ── size handling ── */
  const applySizeFromWidth = useCallback((widthUm: number, forShape: Shape, forAspect: number) => {
    const d = safeDerive(forShape, forAspect, { widthUm });
    setSizeUm(d);
    setWidthText(safeFormatCm(d.widthUm));
    setHeightText(forShape === 'circle' ? '' : safeFormatCm(d.heightUm));
  }, []);

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
        setSizeUm(prefill);
        setWidthText(safeFormatCm(prefill.widthUm));
        setHeightText(forShape === 'circle' ? '' : safeFormatCm(prefill.heightUm));
      } else {
        const w = safeParseCm(widthText);
        if (w) applySizeFromWidth(w, forShape, source.pxWidth / source.pxHeight);
      }
    },
    [settings.maxUploadBytes, widthText, applySizeFromWidth],
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

  const clearDesign = useCallback(() => {
    decodeToken.current++;
    lastFile.current = null;
    setDesign(null);
    setDesignError(null);
    setDecoding(false);
  }, []);

  /* ── derived: spec, layout, quality ── */
  const spec = useMemo<StickerSpec | null>(() => {
    if (!shape || !sizeUm) return null;
    return {
      shape,
      ...(shape === 'rect' ? { corners } : {}),
      widthUm: shape === 'circle' ? sizeUm.widthUm : sizeUm.widthUm,
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

  /* ── quantity: material + sheets (price is derived, never stored) ── */
  const pricing = settings.pricing;
  const materials = useMemo(() => enabledMaterials(pricing), [pricing]);
  // Chosen material if still enabled; otherwise paper (or the only/first enabled one).
  const material: Material | null =
    materialChoice && materials.includes(materialChoice) ? materialChoice : materials.includes('paper') ? 'paper' : (materials[0] ?? null);
  const sheets = parseSheets(sheetsText);
  const quantityError =
    material === null ? ('material_disabled' as const) : sheets === null ? ('not_integer' as const) : validateQuantity(material, sheets, pricing);

  const setSheets = useCallback((n: number) => setSheetsText(String(clampSheets(n, pricing))), [pricing]);
  const stepSheets = useCallback(
    (delta: number) => setSheetsText((t) => String(clampSheets((parseSheets(t) ?? pricing.minSheets) + delta, pricing))),
    [pricing],
  );

  const price = material && sheets !== null && !quantityError && layout ? safePrice(material, sheets, layout.countPerSheet, settings) : null;
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
    clearDesign,
    widthText,
    heightText,
    onWidthChange,
    onHeightChange,
    sizeUm,
    spec,
    outcome: settled ? outcome : null,
    layout,
    aspect,
    maxWidthUm,
    dpi,
    dpiState,
    materials,
    material,
    setMaterial: setMaterialChoice,
    sheets,
    sheetsText,
    setSheetsText,
    setSheets,
    stepSheets,
    quantityError,
    price,
    summary,
    fields,
    setField,
    validation,
    customerErrors,
    showErrors,
    setShowErrors,
  };
}

export type BuilderApi = ReturnType<typeof useBuilder>;
