'use client';

import { sendTrack } from '@/lib/analytics/client';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { enabledMaterials, sheetsForStickers, validateStickers } from '@/lib/pricing';
import { decodeDesign } from '@/lib/design/decode.client';
import { clearDraftFile, loadDraftFile, saveDraftFile } from './draft-store';
import { logClient } from './logClient';
import {
  EMPTY_FIELDS,
  STEPS,
  buildSummary,
  clampStep,
  dpiFor,
  dpiStatus,
  furthestStep,
  loadDraft,
  parseStickers,
  pdfPrefillUm,
  restoredState,
  saveDraft,
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

/** A restore that has not finished after this long stops hiding the page; it still completes unless the customer starts something else. */
const RESTORE_TIMEOUT_MS = 10_000;

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
  // Restore after a reload: the step to open (null = nothing to restore) and whether the design file is back.
  const [pendingStep, setPendingStep] = useState<number | null>(null);
  const [designRestored, setDesignRestored] = useState(false);
  // The restore took too long: the page is shown while it goes on.
  const [gaveUp, setGaveUp] = useState(false);
  // Id of the design file stored for this form (saved with it; a stored file with another id belongs to another tab's order).
  const [fileId, setFileId] = useState<string | null>(null);

  const lastFile = useRef<File | null>(null);
  // The file currently kept in IndexedDB, so a re-decode of the same file (shape change) does not save it again.
  const persistedFile = useRef<File | null>(null);
  const fileIdRef = useRef<string | null>(null);
  const pendingStepRef = useRef<number | null>(null);
  const restoreCancelled = useRef(false);
  const decodeToken = useRef(0);
  const restoredStepRef = useRef(false);

  useRevokeObjectUrl(design?.previewUrl ?? null);

  const changeFileId = useCallback((id: string | null) => {
    fileIdRef.current = id;
    setFileId(id);
  }, []);
  useEffect(() => {
    pendingStepRef.current = pendingStep;
  }, [pendingStep]);

  /** The customer started something while a (slow) restore was still running: the restore stops, theirs wins. */
  const cancelRestore = useCallback(() => {
    if (pendingStepRef.current === null) return;
    restoreCancelled.current = true;
    decodeToken.current++; // a late restore decode is dropped
    pendingStepRef.current = null;
    setDecoding(false);
    setDesignRestored(true);
    setPendingStep(null);
    // The stored file was not brought back, so this form no longer claims it.
    if (!persistedFile.current) changeFileId(null);
  }, [changeFileId]);

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

  /* ── design decoding (the one path for a fresh pick and for the restore after a reload) ── */
  const loadDesign = useCallback(
    async (file: File, forShape: Shape, opts: { restore?: boolean; keepSize?: boolean } = {}) => {
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
        // A failed pick, or a stored file that no longer decodes: no design is left to keep.
        persistedFile.current = null;
        if (fileIdRef.current) void clearDraftFile(fileIdRef.current);
        changeFileId(null);
        return;
      }
      setDesign(source);
      if (opts.restore) persistedFile.current = file;
      else if (persistedFile.current !== file) {
        persistedFile.current = file;
        const id = nanoid();
        changeFileId(id);
        void saveDraftFile(file, id);
      }
      // A restore keeps the sizes the customer had typed; a fresh pick prefills them.
      if (opts.keepSize) return;
      const prefill = pdfPrefillUm(source, forShape);
      if (prefill) {
        showSize(prefill, forShape);
      } else {
        const w = safeParseCm(widthText);
        if (w) applySizeFromWidth(w, forShape, source.pxWidth / source.pxHeight);
      }
    },
    [settings.maxUploadBytes, widthText, applySizeFromWidth, showSize, changeFileId],
  );

  /* ── restore the saved order once on the client ── */
  useEffect(() => {
    const saved = loadDraft();
    let cancelled = false;
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
      setPendingStep(r.step ?? 0);
      pendingStepRef.current = r.step ?? 0;
      if (r.shape && r.fileId) {
        // The design file comes back through the same decoder as a fresh pick, without touching the saved sizes.
        // Only the file saved with THIS form comes back: another tab may have stored a different one since.
        const keepSize = Boolean(r.sizeUm || r.widthText?.trim());
        const forShape = r.shape;
        const wantedId = r.fileId;
        changeFileId(wantedId);
        void loadDraftFile().then(async (stored) => {
          if (cancelled || restoreCancelled.current) return;
          if (stored && stored.id === wantedId) await loadDesign(stored.file, forShape, { restore: true, keepSize });
          else changeFileId(null);
          if (!cancelled) setDesignRestored(true);
        });
      } else {
        setDesignRestored(true);
      }
    } else {
      // No (or an expired) saved order: a design file left behind by it goes too.
      void clearDraftFile();
    }
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once; the restore must not repeat when `settings` or the texts change
  }, []);

  // While a restore is pending the saved values are already in state: do not overwrite the saved step with 0.
  useEffect(() => {
    if (!hydrated || !shape || pendingStep !== null) return;
    saveDraft({ shape, corners, widthText, heightText, sizeUm, material: materialChoice, stickersText: typedStickers ?? '', step, ...(fileId ? { fileId } : {}), ...fields });
  }, [hydrated, pendingStep, shape, corners, widthText, heightText, sizeUm, materialChoice, typedStickers, fields, step, fileId]);

  const setShape = useCallback(
    (next: Shape) => {
      if (next === shape) return;
      cancelRestore();
      const prev = shape;
      setShapeState(next);
      const w = safeParseCm(widthText);
      if (w) applySizeFromWidth(w, next, next === 'circle' ? 1 : aspect);
      // Only 'custom' changes how a file is decoded (alpha trim / alpha required).
      if ((next === 'custom' || prev === 'custom') && lastFile.current && (design || designError)) {
        void loadDesign(lastFile.current, next);
      }
    },
    [shape, widthText, aspect, applySizeFromWidth, design, designError, loadDesign, cancelRestore],
  );

  const onFile = useCallback(
    (file: File) => {
      if (!shape) return;
      cancelRestore();
      return loadDesign(file, shape);
    },
    [shape, loadDesign, cancelRestore],
  );

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
  const goTo = useCallback(
    (i: number) => {
      if (!canGoTo(i)) return false;
      cancelRestore();
      setStep(Math.max(0, Math.min(STEPS.length - 1, i)));
      return true;
    },
    [canGoTo, cancelRestore],
  );

  // Finish a restore: once the design is back and the layout has settled, open the saved step (never past what canGoTo allows).
  const restoreReady = pendingStep !== null && designRestored && !decoding && settled;
  const furthest = furthestStep(stepOk);
  useEffect(() => {
    if (!restoreReady) return;
    /* eslint-disable react-hooks/set-state-in-effect -- one-time restore, runs when the saved order is back */
    const target = clampStep(pendingStep, furthest);
    if (target !== step) restoredStepRef.current = true;
    setStep(target);
    setPendingStep(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [restoreReady, pendingStep, furthest, step]);
  /** True once after a restore moved the step: the page then skips its focus-the-heading scroll. */
  const consumeRestoredStep = useCallback(() => {
    const v = restoredStepRef.current;
    restoredStepRef.current = false;
    return v;
  }, []);
  // After a while show the page anyway (a slow decode must not keep it hidden). The restore itself goes on, and the
  // saved step stays untouched until it ends: the save effect waits for pendingStep to clear.
  useEffect(() => {
    if (pendingStep === null) return;
    const t = setTimeout(() => setGaveUp(true), RESTORE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [pendingStep]);
  useTrackStepOnce(STEPS[step]);

  const next = useCallback(() => goTo(step + 1), [goTo, step]);
  const back = useCallback(() => {
    cancelRestore();
    setStep((s) => Math.max(0, s - 1));
  }, [cancelRestore]);

  /* ── customer ── */
  const setField = useCallback((key: keyof FormFields, value: string) => setFields((f) => ({ ...f, [key]: value })), []);
  const validation = useMemo(() => validateCustomer(fields), [fields]);
  const customerErrors: CustomerErrors = showErrors ? validation.errors : {};

  return {
    settings,
    step,
    /** True while a saved order is being brought back: the page is hidden (nothing can race the restore) until it ends or takes too long. */
    restoring: pendingStep !== null && !gaveUp,
    consumeRestoredStep,
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
