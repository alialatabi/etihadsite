'use client';

import { sendTrack } from '@/lib/analytics/client';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { enabledMaterials, sheetsForStickers, validateStickers } from '@/lib/pricing';
import { decodeDesign } from '@/lib/design/decode.client';
import {
  clearDraftExtraFile,
  clearDraftExtraFiles,
  clearDraftFile,
  loadDraftExtraFile,
  loadDraftFile,
  saveDraftExtraFile,
  saveDraftFile,
} from './draft-store';
import { logClient } from './logClient';
import {
  EMPTY_FIELDS,
  STEPS,
  aiAcceptedSize,
  aiSizeDrifted,
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
  shapeStepOk,
  stepStickers,
  stickersTextFor,
  validateCustomer,
  type BuilderMode,
  type CustomerErrors,
  type FormFields,
  type SavedExtra,
  type StepId,
} from './logic';
import {
  allDesignsReady,
  anyDpiBlocked,
  aspectOf,
  buildMultiSpecs,
  designCount,
  designRows,
  designSizes,
  editHeight,
  editWidth,
  isMultiActive,
  PickGate,
  maxWidthsFor,
  perDesignTotal,
  savedExtras,
  showSizeEdit,
  sizeFromTexts,
  sizeFromWidthUm,
  slotsReducer,
  splitPick,
  type DesignSlot,
  type SizeEdit,
} from './multi-logic';
import { maxWidthAtAspect, safeDerive, safeFormatCm, safeLayout, safeMultiLayout, safeParseCm, safePriceForStickers } from './safe';
import { useDebounced } from './useDebounced';
import type { Corners, DesignDecodeError, DesignSource, Material, Shape, ShopSettings, StickerSpec } from '@/lib/types';

type SizeUm = { widthUm: number; heightUm: number };

/** Object URL hygiene for the extra designs: revokes the URLs of designs that left, and all of them on unmount. */
function useRevokeSlotUrls(slots: DesignSlot[]): void {
  const known = useRef(new Set<string>());
  useEffect(() => {
    const now = new Set<string>();
    for (const s of slots) if (s.design) now.add(s.design.previewUrl);
    for (const url of [...known.current]) {
      if (now.has(url)) continue;
      known.current.delete(url);
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
    for (const url of now) known.current.add(url);
  }, [slots]);
  useEffect(() => {
    const urls = known.current;
    return () => {
      for (const url of urls) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
      }
    };
  }, []);
}

/** A restore that has not finished after this long stops hiding the page; it still completes unless the customer starts something else. */
const RESTORE_TIMEOUT_MS = 10_000;

/** Object URL hygiene: revokes the previous URL when `url` changes, and the last one on unmount. */
function useRevokeObjectUrl(url: string | null): void {
  useEffect(() => {
    if (!url) return;
    return () => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    };
  }, [url]);
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
  // WhatsApp-offers opt-in: session-only React state, unticked on every fresh page. Deliberately not in `fields`:
  // it is never written to the draft or to sessionStorage, so it can never come back pre-ticked.
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // Restore after a reload: the step to open (null = nothing to restore) and whether the design file is back.
  const [pendingStep, setPendingStep] = useState<number | null>(null);
  const [designRestored, setDesignRestored] = useState(false);
  // The restore took too long: the page is shown while it goes on.
  const [gaveUp, setGaveUp] = useState(false);
  // Id of the design file stored for this form (saved with it; a stored file with another id belongs to another tab's order).
  const [fileId, setFileId] = useState<string | null>(null);
  // AI designer: how the design is made (a reload of an older draft, which has no mode, is an upload), the idea,
  // and the accepted AI design (its server upload, the draft fileId it got, the size it was accepted at).
  const [mode, setMode] = useState<BuilderMode>('ai');
  const [idea, setIdea] = useState('');
  const [aiUploadId, setAiUploadId] = useState<string | null>(null);
  const [aiFileId, setAiFileId] = useState<string | null>(null);
  const [aiSizeUm, setAiSizeUm] = useState<{ w: number; h: number } | null>(null);
  // The lines printed on the accepted AI design (saved with the draft: the arrangement step warns about too much text).
  const [aiLines, setAiLines] = useState<string[] | null>(null);
  // Several designs (upload mode only): the box, and designs 2..N. Design 1 stays in the scalar state above.
  // The mode is multi only while at least one extra exists (isMultiActive); with none everything behaves as single.
  const [multi, setMultiState] = useState(false);
  const [extras, dispatchExtras] = useReducer(slotsReducer, [] as DesignSlot[]);
  const extrasRef = useRef<DesignSlot[]>([]);
  /** Decode token of each extra design (a newer read of the same slot, or its removal, drops an older answer). */
  const slotTokens = useRef(new Map<string, number>());
  /** Picks whose extra files wait for design 1 to finish reading; the extras being dropped cancels them. */
  const pickGate = useRef(new PickGate());
  const multiActive = isMultiActive(mode, multi, extras.length);

  const lastFile = useRef<File | null>(null);
  // The file currently kept in IndexedDB, so a re-decode of the same file (shape change) does not save it again.
  const persistedFile = useRef<File | null>(null);
  const fileIdRef = useRef<string | null>(null);
  const pendingStepRef = useRef<number | null>(null);
  const restoreCancelled = useRef(false);
  const decodeToken = useRef(0);
  const restoredStepRef = useRef(false);

  useRevokeObjectUrl(design?.previewUrl ?? null);
  useRevokeSlotUrls(extras);
  useEffect(() => {
    extrasRef.current = extras;
  }, [extras]);
  // The latest size of design 1 (also set the moment a decode shows one): a design added in the same pick starts at its width.
  const sizeUmRef = useRef<SizeUm | null>(null);
  useEffect(() => {
    sizeUmRef.current = sizeUm;
  }, [sizeUm]);

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
    slotTokens.current.clear(); // ... also the extra designs'
    dispatchExtras({ type: 'dropUndecoded' });
    pendingStepRef.current = null;
    setDecoding(false);
    setDesignRestored(true);
    setPendingStep(null);
    // The stored file was not brought back, so this form no longer claims it.
    if (!persistedFile.current) changeFileId(null);
  }, [changeFileId]);

  const aspect = design ? design.pxWidth / design.pxHeight : 1;
  // Before any design a rectangle's width and height are typed freely (the AI design is made in that ratio). On page 1
  // of the AI path they stay free after an accept too: a new idea may need another ratio. Leaving page 1 without a new
  // accept locks the size to the design again (goTo); an accept derives it from the new design (acceptAi).
  const freeRectFor = useCallback((s: Shape | null) => s === 'rect' && (!design || (mode === 'ai' && step === 0)), [design, mode, step]);
  const freeRect = freeRectFor(shape);

  /** The accepted AI design no longer is the design (a new file, a shape change, «عندي تصميم جاهز»). */
  const clearAi = useCallback(() => {
    setAiUploadId(null);
    setAiFileId(null);
    setAiSizeUm(null);
    setAiLines(null);
  }, []);

  /* ── size handling ── */
  /** Show a size in both inputs (a circle has no height field). */
  const showSize = useCallback((d: SizeUm, forShape: Shape) => {
    sizeUmRef.current = d;
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
      if (freeRect) {
        const w = safeParseCm(text);
        const h = safeParseCm(heightText);
        setSizeUm(w && h ? { widthUm: w, heightUm: h } : null);
        return;
      }
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
    [shape, aspect, freeRect, heightText],
  );

  const onHeightChange = useCallback(
    (text: string) => {
      setHeightText(text);
      if (freeRect) {
        const w = safeParseCm(widthText);
        const h = safeParseCm(text);
        setSizeUm(w && h ? { widthUm: w, heightUm: h } : null);
        return;
      }
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
    [shape, aspect, freeRect, widthText],
  );

  /* ── design decoding (the one path for a fresh pick and for the restore after a reload) ── */
  const loadDesign = useCallback(
    async (
      file: File,
      forShape: Shape,
      opts: { restore?: boolean; keepSize?: boolean; ai?: { uploadId: string; typed: SizeUm; lines: string[] } } = {},
    ): Promise<boolean> => {
      const token = ++decodeToken.current;
      const previousFile = lastFile.current;
      lastFile.current = file;
      setDecoding(true);
      // An AI accept that fails must leave the current design (and its message) as they are.
      if (!opts.ai) setDesignError(null);
      let error: DesignDecodeError | null = null;
      let source: DesignSource | null = null;
      try {
        const out = await decodeDesign(file, { shape: forShape, maxBytes: settings.maxUploadBytes });
        if (out.ok) source = out.source;
        else error = out.error;
      } catch (e) {
        error = 'corrupt';
        logClient(
          { step: 'decode', message: e instanceof Error ? e.message : 'decode threw', fileType: file.type, fileSize: file.size },
          { report: { error: e } },
        );
      }
      if (token !== decodeToken.current) {
        // A newer decode superseded this one: drop its object URL.
        if (source) URL.revokeObjectURL(source.previewUrl);
        return false;
      }
      setDecoding(false);
      if (!source) {
        if (error && error !== 'no_alpha') logClient({ step: 'decode', message: error, fileType: file.type, fileSize: file.size });
        if (opts.ai) {
          // A generated PNG that does not decode here: keep whatever design was loaded before.
          lastFile.current = previousFile;
          return false;
        }
        setDesign(null);
        setDesignError(error);
        // A failed pick, or a stored file that no longer decodes: no design is left to keep.
        persistedFile.current = null;
        if (fileIdRef.current) void clearDraftFile(fileIdRef.current);
        changeFileId(null);
        return false;
      }
      setDesign(source);
      if (opts.restore) persistedFile.current = file;
      else if (persistedFile.current !== file) {
        persistedFile.current = file;
        const id = nanoid();
        changeFileId(id);
        void saveDraftFile(file, id);
      }
      if (opts.ai) {
        // An accepted AI design: its upload is reused at submit while the design is this very file (fileId).
        const size = aiAcceptedSize(forShape, opts.ai.typed, source.pxWidth / source.pxHeight);
        showSize(size, forShape);
        setAiUploadId(opts.ai.uploadId);
        setAiFileId(fileIdRef.current);
        setAiSizeUm({ w: size.widthUm, h: forShape === 'circle' ? size.widthUm : size.heightUm });
        setAiLines(opts.ai.lines);
        return true;
      }
      // A restore keeps the sizes the customer had typed; a fresh pick prefills them.
      if (opts.keepSize) return true;
      const prefill = pdfPrefillUm(source, forShape);
      if (prefill) {
        showSize(prefill, forShape);
      } else {
        const w = safeParseCm(widthText);
        if (w) applySizeFromWidth(w, forShape, source.pxWidth / source.pxHeight);
      }
      return true;
    },
    [settings.maxUploadBytes, widthText, applySizeFromWidth, showSize, changeFileId],
  );

  /* ── extra designs (2..N): the same decoder, one slot each ── */
  /**
   * Read one extra design. `restore`: a saved extra coming back (its typed sizes and file id are kept, a file that no
   * longer decodes is dropped). `reuse`: the same file read again (a shape change): the typed width is kept and the
   * saved copy stays. `baseWidthUm`: the width to start a fresh design at (design 1's, cut to what this design allows).
   */
  const decodeSlot = useCallback(
    async (
      id: string,
      file: File,
      forShape: Shape,
      opts: { restore?: { fileId: string; widthText: string; heightText: string }; reuse?: boolean; baseWidthUm?: number | null } = {},
    ): Promise<boolean> => {
      const token = (slotTokens.current.get(id) ?? 0) + 1;
      slotTokens.current.set(id, token);
      dispatchExtras({ type: 'start', id, file });
      let error: DesignDecodeError | null = null;
      let source: DesignSource | null = null;
      try {
        const out = await decodeDesign(file, { shape: forShape, maxBytes: settings.maxUploadBytes });
        if (out.ok) source = out.source;
        else error = out.error;
      } catch (e) {
        error = 'corrupt';
        logClient(
          { step: 'decode', message: e instanceof Error ? e.message : 'decode threw', fileType: file.type, fileSize: file.size },
          { report: { error: e } },
        );
      }
      if (slotTokens.current.get(id) !== token) {
        // Removed or read again meanwhile: drop this answer and its object URL.
        if (source) URL.revokeObjectURL(source.previewUrl);
        return false;
      }
      const prev = extrasRef.current.find((s) => s.id === id);
      if (!source) {
        if (error && error !== 'no_alpha') logClient({ step: 'decode', message: error, fileType: file.type, fileSize: file.size });
        if (prev?.fileId) void clearDraftExtraFile(prev.fileId);
        if (opts.restore) {
          slotTokens.current.delete(id);
          dispatchExtras({ type: 'remove', id });
          void clearDraftExtraFile(opts.restore.fileId);
        } else {
          dispatchExtras({ type: 'failed', id, error: error ?? 'corrupt' });
        }
        return false;
      }
      const aspect = aspectOf(source);
      let size: SizeEdit;
      let fileId: string;
      if (opts.restore) {
        // The saved texts come back as typed; the size follows from them and the artwork.
        size = {
          widthText: opts.restore.widthText,
          heightText: opts.restore.heightText,
          sizeUm: sizeFromTexts(forShape, aspect, opts.restore.widthText, opts.restore.heightText),
        };
        fileId = opts.restore.fileId;
      } else if (opts.reuse && prev) {
        const w = safeParseCm(prev.widthText);
        size = w ? sizeFromWidthUm(forShape, aspect, w) : { widthText: prev.widthText, heightText: prev.heightText, sizeUm: null };
        if (prev.fileId) fileId = prev.fileId;
        else {
          fileId = nanoid();
          void saveDraftExtraFile(file, fileId);
        }
      } else {
        const prefill = pdfPrefillUm(source, forShape);
        if (prefill) size = showSizeEdit(forShape, prefill);
        else if (opts.baseWidthUm) {
          const max = maxWidthAtAspect(forShape, corners, forShape === 'circle' ? 1 : aspect, settings.layout);
          size = sizeFromWidthUm(forShape, aspect, max ? Math.min(opts.baseWidthUm, max) : opts.baseWidthUm);
        } else size = { widthText: '', heightText: '', sizeUm: null };
        if (prev?.fileId) void clearDraftExtraFile(prev.fileId);
        fileId = nanoid();
        void saveDraftExtraFile(file, fileId);
      }
      dispatchExtras({ type: 'decoded', id, design: source, fileId, size });
      return true;
    },
    [settings.maxUploadBytes, settings.layout, corners],
  );

  /** The box is ticked or unticked. Unticking keeps design 1 and drops the extras (no question asked). */
  const dropExtras = useCallback(() => {
    slotTokens.current.clear(); // an extra still being read is dropped when it answers
    pickGate.current.reset(); // and so are the extras of a pick that is still waiting for design 1
    dispatchExtras({ type: 'reset' });
    void clearDraftExtraFiles();
  }, []);
  const setMulti = useCallback(
    (on: boolean) => {
      cancelRestore();
      setMultiState(on);
      if (!on) dropExtras();
    },
    [cancelRestore, dropExtras],
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
      // A draft saved before the AI designer existed has no mode: it was an upload.
      setMode(r.mode ?? 'upload');
      if (r.idea !== undefined) setIdea(r.idea);
      if (r.aiUploadId !== undefined) setAiUploadId(r.aiUploadId);
      if (r.aiFileId !== undefined) setAiFileId(r.aiFileId);
      if (r.aiSizeUm !== undefined) setAiSizeUm(r.aiSizeUm);
      if (r.aiLines !== undefined) setAiLines(r.aiLines);
      setFields(r.fields);
      setPendingStep(r.step ?? 0);
      pendingStepRef.current = r.step ?? 0;
      if (r.shape && r.fileId) {
        // The design file comes back through the same decoder as a fresh pick, without touching the saved sizes.
        // Only the file saved with THIS form comes back: another tab may have stored a different one since.
        const keepSize = Boolean(r.sizeUm || r.widthText?.trim());
        const forShape = r.shape;
        const wantedId = r.fileId;
        // Extra designs of a multi-design order come back after design 1 (a file that is gone or no longer decodes is dropped).
        const savedExtrasList = r.multi?.extras ?? null;
        if (savedExtrasList) setMultiState(true);
        const restoreExtras = async (list: SavedExtra[]) => {
          for (const item of list) {
            if (cancelled || restoreCancelled.current) return;
            const stored = await loadDraftExtraFile(item.fileId);
            if (cancelled || restoreCancelled.current) return;
            if (stored) await decodeSlot(nanoid(), stored.file, forShape, { restore: item });
          }
        };
        changeFileId(wantedId);
        void loadDraftFile().then(async (stored) => {
          if (cancelled || restoreCancelled.current) return;
          let back = false;
          if (stored && stored.id === wantedId) back = await loadDesign(stored.file, forShape, { restore: true, keepSize });
          else changeFileId(null);
          if (cancelled || restoreCancelled.current) return; // the customer started something else meanwhile
          if (savedExtrasList) {
            if (back) await restoreExtras(savedExtrasList);
            else void clearDraftExtraFiles(); // design 1 is gone or no longer reads: its extras belong to nothing
          }
          if (!cancelled) setDesignRestored(true);
        });
      } else {
        // A multi-design draft whose design 1 file is not saved: its extras go.
        if (r.multi) void clearDraftExtraFiles();
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
    saveDraft({
      shape,
      corners,
      widthText,
      heightText,
      sizeUm,
      material: materialChoice,
      stickersText: typedStickers ?? '',
      step,
      ...(fileId ? { fileId } : {}),
      mode,
      ...(idea ? { idea } : {}),
      ...(aiUploadId ? { aiUploadId } : {}),
      ...(aiFileId ? { aiFileId } : {}),
      ...(aiSizeUm ? { aiSizeUm } : {}),
      ...(aiLines && aiLines.length > 0 ? { aiLines } : {}),
      ...fields,
      // Only a multi-design order adds this key: a single-design draft is saved exactly as before.
      ...(multiActive ? { multi: { extras: savedExtras(extras) } } : {}),
    });
  }, [hydrated, pendingStep, shape, corners, widthText, heightText, sizeUm, materialChoice, typedStickers, fields, step, fileId, mode, idea, aiUploadId, aiFileId, aiSizeUm, aiLines, multiActive, extras]);

  const setShape = useCallback(
    (next: Shape) => {
      if (next === shape) return;
      cancelRestore();
      const prev = shape;
      setShapeState(next);
      clearAi(); // the accepted AI design was made for the other shape
      const w = safeParseCm(widthText);
      const h = safeParseCm(heightText);
      if (freeRectFor(next) && w && h) {
        setSizeUm({ widthUm: w, heightUm: h }); // free rectangle: keep both typed sides
      } else if (w) applySizeFromWidth(w, next, next === 'circle' ? 1 : aspect);
      // Only 'custom' changes how a file is decoded (alpha trim / alpha required).
      if ((next === 'custom' || prev === 'custom') && lastFile.current && (design || designError)) {
        void loadDesign(lastFile.current, next);
      }
      // The extra designs of a multi-design order follow: sizes derive again, and a custom change reads every file again.
      if (extras.length > 0) {
        dispatchExtras({ type: 'reshape', shape: next });
        if (next === 'custom' || prev === 'custom') {
          for (const s of extras) if (s.file && (s.design || s.error)) void decodeSlot(s.id, s.file, next, { reuse: true });
        }
      }
    },
    [shape, widthText, heightText, aspect, applySizeFromWidth, design, designError, loadDesign, cancelRestore, clearAi, freeRectFor, extras, decodeSlot],
  );

  const onFile = useCallback(
    (file: File) => {
      if (!shape) return;
      cancelRestore();
      clearAi(); // a new design: the AI upload is not this file
      return loadDesign(file, shape);
    },
    [shape, loadDesign, cancelRestore, clearAi],
  );

  /* ── several designs: adding, replacing, removing, sizing ── */
  /**
   * Files picked with «إضافة تصميم» or dropped: the first becomes design 1 while that is still empty, the rest are
   * extra designs up to MAX_DESIGNS. Returns how many files were over the cap and ignored.
   */
  const addFiles = useCallback(
    (files: File[]): number => {
      if (!shape) return 0;
      cancelRestore();
      // Extras of an earlier pick that still waits for design 1 count against the cap too.
      const pick = splitPick(files, design !== null || decoding, extras.length + pickGate.current.pending);
      const epoch = pickGate.current.begin(pick.extras.length);
      void (async () => {
        if (pick.first) {
          clearAi();
          await loadDesign(pick.first, shape); // the other files start at the width design 1 got
        }
        // The box was unticked (or AI mode started) while design 1 was being read: nothing is started.
        if (!pickGate.current.settle(epoch, pick.extras.length)) return;
        for (const f of pick.extras) void decodeSlot(nanoid(), f, shape, { baseWidthUm: sizeUmRef.current?.widthUm ?? null });
      })();
      return pick.ignored;
    },
    [shape, design, decoding, extras.length, cancelRestore, clearAi, loadDesign, decodeSlot],
  );

  /** A new file for an extra design. */
  const replaceExtra = useCallback(
    (id: string, file: File) => {
      if (!shape) return;
      cancelRestore();
      const prev = extrasRef.current.find((s) => s.id === id);
      void decodeSlot(id, file, shape, { baseWidthUm: prev?.sizeUm?.widthUm ?? sizeUmRef.current?.widthUm ?? null });
    },
    [shape, cancelRestore, decodeSlot],
  );

  const removeExtra = useCallback((id: string) => {
    slotTokens.current.delete(id);
    const s = extrasRef.current.find((x) => x.id === id);
    if (s?.fileId) void clearDraftExtraFile(s.fileId);
    dispatchExtras({ type: 'remove', id });
  }, []);

  /**
   * Remove design `index` (0 = design 1). Removing design 1 while extras exist moves the first extra up into design 1
   * (its file is read again as design 1, its typed size kept); removing the only design leaves the upload area empty.
   */
  const removeDesign = useCallback(
    (index: number) => {
      cancelRestore();
      if (index > 0) {
        const s = extrasRef.current[index - 1];
        if (s) removeExtra(s.id);
        return;
      }
      decodeToken.current++; // an answer still on its way for the old design 1 is dropped
      clearAi();
      const first = extrasRef.current[0];
      if (first && first.file && shape) {
        removeExtra(first.id);
        setWidthText(first.widthText);
        setHeightText(first.heightText);
        setSizeUm(first.sizeUm);
        void loadDesign(first.file, shape, { keepSize: true });
        return;
      }
      setDecoding(false);
      setDesign(null);
      setDesignError(null);
      lastFile.current = null;
      persistedFile.current = null;
      if (fileIdRef.current) void clearDraftFile(fileIdRef.current);
      changeFileId(null);
    },
    [shape, cancelRestore, clearAi, removeExtra, loadDesign, changeFileId],
  );

  const onExtraWidthChange = useCallback(
    (id: string, text: string) => {
      const s = extras.find((x) => x.id === id);
      if (!s || !shape) return;
      dispatchExtras({ type: 'size', id, size: s.design ? editWidth(shape, aspectOf(s.design), text, s.heightText) : { widthText: text, heightText: s.heightText, sizeUm: null } });
    },
    [extras, shape],
  );
  const onExtraHeightChange = useCallback(
    (id: string, text: string) => {
      const s = extras.find((x) => x.id === id);
      if (!s || !shape) return;
      dispatchExtras({ type: 'size', id, size: s.design ? editHeight(shape, aspectOf(s.design), text, s.widthText) : { widthText: s.widthText, heightText: text, sizeUm: null } });
    },
    [extras, shape],
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

  const maxWidthUm = useMemo(
    () => (shape ? maxWidthAtAspect(shape, corners, aspect, settings.layout) : null),
    [shape, corners, aspect, settings.layout],
  );

  const dpi = design && spec ? dpiFor(design, spec) : null;
  const dpiState = dpiStatus(dpi, settings.quality);

  /* ── several designs: one layout for all of them (equal copies of each) ── */
  // The specs are memoised on the sizes as a string, not on `extras`: reading a file or a decode error must not
  // un-settle the layout (settled compares by reference).
  const extraSizesKey = JSON.stringify(extras.map((e) => e.sizeUm));
  const multiSpecs = useMemo(
    () => (multiActive && shape ? buildMultiSpecs(spec, shape, corners, JSON.parse(extraSizesKey) as (SizeUm | null)[]) : null),
    [multiActive, shape, corners, spec, extraSizesKey],
  );
  const debouncedMultiSpecs = useDebounced(multiSpecs, 100);
  const multiOutcome = useMemo(
    () => (debouncedMultiSpecs ? safeMultiLayout(debouncedMultiSpecs, settings.layout) : null),
    [debouncedMultiSpecs, settings.layout],
  );
  const multiSettled = debouncedMultiSpecs === multiSpecs;
  const multiLayout = multiActive && multiOutcome && multiOutcome.ok ? multiOutcome.layout : null;
  const allSettled = settled && (!multiActive || multiSettled);
  const aspectsKey = [design, ...extras.map((e) => e.design)].map((d) => (d ? aspectOf(d) : 0)).join(',');
  const rowMaxWidths = useMemo(
    () => (multi && shape ? maxWidthsFor(shape, corners, aspectsKey.split(',').map(Number), settings.layout) : []),
    [multi, shape, corners, aspectsKey, settings.layout],
  );
  const rows = multi && shape ? designRows({ shape, corners, design, decoding, designError, widthText, heightText, spec, extras, maxWidths: rowMaxWidths, quality: settings.quality }) : [];
  const anyDecoding = decoding || extras.some((e) => e.decoding);
  // The preview URL of every design (design 1 first), stable while none of them changes (the sheet preview is memoised).
  const urlsKey = [design, ...extras.map((e) => e.design)].map((d) => d?.previewUrl ?? '').join('\n');
  const previewUrls = useMemo(() => urlsKey.split('\n').map((u) => u || null), [urlsKey]);

  /* ── quantity: material + sticker count (sheets and price are derived, never stored) ── */
  const pricing = settings.pricing;
  const materials = useMemo(() => enabledMaterials(pricing), [pricing]);
  // Chosen material if still enabled; otherwise paper (or the only/first enabled one).
  const material: Material | null =
    materialChoice && materials.includes(materialChoice) ? materialChoice : materials.includes('paper') ? 'paper' : (materials[0] ?? null);
  // The ONE number every quantity and price rule works with: designs × copies of each on a multi-design sheet.
  const countPerSheet = multiActive ? (multiLayout ? multiLayout.countPerSheet : null) : layout ? layout.countPerSheet : null;
  const layoutOk = countPerSheet !== null;
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

  // Each design is received sheets × copies-per-sheet times.
  const perDesign = multiActive && multiLayout ? multiLayout.perDesign : null;
  const perDesignCount = perDesignTotal(sheets, multiActive ? multiLayout : null);

  const price =
    material && stickers !== null && !quantityError && countPerSheet !== null
      ? safePriceForStickers(material, stickers, countPerSheet, settings)
      : null;
  const summary =
    spec && countPerSheet !== null && price
      ? buildSummary(
          spec,
          { countPerSheet },
          price,
          multiActive && multiLayout && debouncedMultiSpecs ? { designs: designSizes(debouncedMultiSpecs), perDesign: multiLayout.perDesign } : undefined,
        )
      : null;

  const sizeOk = !!layout && settled;
  const stepOk: Record<StepId, boolean> = {
    shape: shapeStepOk({ shape, mode, sizeOk }),
    design: multiActive ? allDesignsReady(rows) : design !== null && !decoding,
    size: multiActive ? !!multiLayout && allSettled && !anyDpiBlocked(rows) : !!layout && settled && dpiState !== 'block',
    quantity: !quantityError && layoutOk,
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
  /**
   * Leaving page 1 without a new accept, in any mode: a rectangle typed freely there (AI page 1 frees it even with a
   * design) gets the current design's ratio back, the width kept. A drifted size with a design can only come from
   * there, so the mode is not checked (it may already be 'upload' after «عندي تصميم جاهز»).
   */
  const relockToDesign = useCallback(() => {
    if (shape === 'rect' && design && sizeUm && aiSizeDrifted(sizeUm, aspect)) applySizeFromWidth(sizeUm.widthUm, 'rect', aspect);
  }, [shape, design, sizeUm, aspect, applySizeFromWidth]);

  const goTo = useCallback(
    (i: number) => {
      if (!canGoTo(i)) return false;
      cancelRestore();
      const target = Math.max(0, Math.min(STEPS.length - 1, i));
      if (target > 0) relockToDesign();
      setStep(target);
      return true;
    },
    [canGoTo, cancelRestore, relockToDesign],
  );

  // Finish a restore: once the design is back and the layout has settled, open the saved step (never past what canGoTo allows).
  const restoreReady = pendingStep !== null && designRestored && !anyDecoding && allSettled;
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

  /* ── AI designer ── */
  /** Leaving the upload mode: the box is cleared and the extra designs go (AI mode is never multi). */
  const leaveMulti = useCallback(() => {
    setMultiState(false);
    // Also with no extra yet: a pick waiting for design 1 must not add its extras afterwards.
    if (extrasRef.current.length > 0 || pickGate.current.pending > 0) dropExtras();
  }, [dropExtras]);
  const sizeStep = STEPS.indexOf('size');
  const designStep = STEPS.indexOf('design');
  /**
   * Wrap a generated PNG as the design (decode, preview, draft) at the size it was made for (`typed`), then open the
   * arrangement. Refused when the shape changed since the image was made (a circle PNG is no custom die-cut).
   */
  const acceptAi = useCallback(
    async (file: File, uploadId: string, madeFor: { shape: Shape; widthUm: number; heightUm: number }, lines: string[]) => {
      if (!shape || shape !== madeFor.shape) return false;
      cancelRestore();
      setMode('ai');
      leaveMulti(); // a site-made design is one design: an AI order never carries extras
      const ok = await loadDesign(file, shape, { ai: { uploadId, typed: { widthUm: madeFor.widthUm, heightUm: madeFor.heightUm }, lines } });
      if (ok) setStep(sizeStep);
      return ok;
    },
    [shape, loadDesign, cancelRestore, sizeStep, leaveMulti],
  );
  /** Open the design step directly (a generation started from a valid first page; no debounce wait). */
  const showDesignStep = useCallback(() => {
    cancelRestore();
    setStep(designStep);
  }, [cancelRestore, designStep]);
  /** «عندي تصميم جاهز»: the customer's own file, the existing upload step. */
  const chooseUpload = useCallback(() => {
    if (!shape) return;
    cancelRestore();
    setMode('upload');
    // The accepted AI design stays the design until a file replaces it (onFile clears it); its upload is reused
    // at submit only while the design is that very file (seedUploadId compares fileId with aiFileId).
    // Leaving page 1 (or the design step) this way must not carry a freely typed rectangle to the order either.
    relockToDesign();
    setStep(designStep);
  }, [shape, cancelRestore, designStep, relockToDesign]);
  const startAi = useCallback(() => {
    setMode('ai');
    leaveMulti();
  }, [leaveMulti]);

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
    fileId,
    mode,
    startAi,
    chooseUpload,
    acceptAi,
    showDesignStep,
    idea,
    setIdea,
    aiUploadId,
    aiFileId,
    aiSizeUm,
    aiLines,
    freeRect,
    widthText,
    heightText,
    onWidthChange,
    onHeightChange,
    spec,
    outcome: settled ? outcome : null,
    layout,
    sizeOk,
    maxWidthUm,
    dpi,
    dpiState,
    /* ── several designs (upload mode) ── */
    /** The box «عندي أكثر من تصميم» is ticked. */
    multi,
    setMulti,
    /** Designs 2..N (design 1 is `design` above). */
    extras,
    /** Ticked AND at least one extra: price, layout, submit and preview work on all designs. */
    multiActive,
    /** Every design as a row (design 1 first); empty while the box is not ticked. */
    rows,
    /** Number of design files in the order (design 1 counts once it is read or being read). */
    designCount: designCount(design !== null || decoding, extras.length),
    addFiles,
    replaceExtra,
    removeDesign,
    onExtraWidthChange,
    onExtraHeightChange,
    /** Preview URL of each design, design 1 first. */
    previewUrls,
    /** The layout of all designs together (null while not multi, or while it does not fit). */
    multiLayout,
    /** Why the designs do not fit together, once settled (multi only). */
    multiOutcome: multiActive && allSettled ? multiOutcome : null,
    /** Copies of EACH design on one sheet (multi only). */
    perDesign,
    /** Stickers received of EACH design: sheets × perDesign (multi only). */
    perDesignCount,
    materials,
    material,
    setMaterial: setMaterialChoice,
    countPerSheet,
    /** True when a sheet holds a layout (single or multi): the quantity and price rules may run. */
    layoutOk,
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
    marketingOptIn,
    setMarketingOptIn,
    validation,
    customerErrors,
    setShowErrors,
  };
}

export type BuilderApi = ReturnType<typeof useBuilder>;
