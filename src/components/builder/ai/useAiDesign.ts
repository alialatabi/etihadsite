'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AI_LINE_MAX_CHARS, AI_MAX_LINES } from '@/lib/ai/config';
import { generateBlock, type GenerateBlock } from '../logic';
import { uploadWithProgress } from '../orderApi';
import type { BuilderApi } from '../useBuilder';
import type { Shape } from '@/lib/types';
import { addRefs, aiBusy, isAiOffError, pngFileFromBase64, maxWidthAtSize, printableLines, textWarning as textWarningFor, typedLine, type AiErrorCode, type AiPhase } from './ai-logic';
import { postBrief, postGenerate } from './api';

export type { AiPhase };

export interface AiRef {
  key: number;
  file: File;
  previewUrl: string;
}

export interface AiResultData {
  file: File;
  uploadId: string;
  previewUrl: string;
  /** Pixel size of the generated PNG (for the DPI warning on the result screen). */
  pxWidth: number;
  pxHeight: number;
  /** The shape and size the image was made for (the first page may change while the result waits). */
  madeFor: { shape: Shape; widthUm: number; heightUm: number };
  /** The lines this image was asked to print. */
  lines: string[];
}

function revoke(url: string | undefined): void {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* ignore */
  }
}

/**
 * The AI designer's state across the first page (idea, references, text review) and the design step (progress,
 * result, accept / retry). Lives in Builder so it survives the step change. Every request starts from a click
 * (never from an effect) and is guarded against running twice; a late answer of an abandoned try is dropped.
 */
export function useAiDesign(b: BuilderApi, ready = true) {
  const [phase, setPhase] = useState<AiPhase>('idle');
  const [lines, setLinesState] = useState<string[]>([]);
  const [fixes, setFixes] = useState<{ from: string; to: string }[]>([]);
  const [error, setError] = useState<AiErrorCode | undefined>(undefined);
  const [result, setResult] = useState<AiResultData | undefined>(undefined);
  const [remainingToday, setRemainingToday] = useState<number | null>(null);
  // `ready` (from the server: switch, key, secret) only sets the start; a route's answer can still turn it off.
  const [off, setOff] = useState(!ready || b.settings.ai?.enabled === false);
  const [briefing, setBriefing] = useState(false);
  const [refs, setRefs] = useState<AiRef[]>([]);
  // The last reference pick left files out (wrong type, too big, over 5).
  const [refRejected, setRefRejected] = useState(false);

  const brief = useRef<{ visualDescription: string; briefToken: string } | null>(null);
  const busy = useRef(false);
  const token = useRef(0);
  const refKey = useRef(0);
  // The reference list, written together with setRefs so two quick picks both see the latest list.
  const refsRef = useRef<AiRef[]>([]);
  // Upload id of each reference image (by key), so every later try reuses it.
  const refUploads = useRef(new Map<number, string>());
  const resultUrl = useRef<string | undefined>(undefined);

  useEffect(
    () => () => {
      for (const r of refsRef.current) revoke(r.previewUrl);
      revoke(resultUrl.current);
    },
    [],
  );

  const replaceResult = useCallback((next: AiResultData | undefined) => {
    if (resultUrl.current && resultUrl.current !== next?.previewUrl) revoke(resultUrl.current);
    resultUrl.current = next?.previewUrl;
    setResult(next);
  }, []);

  const { shape, spec, corners, idea, sizeOk } = b;
  const block: GenerateBlock | null = generateBlock({ shape, size: spec, sizeOk, idea, unavailable: off, busy: aiBusy(phase, briefing) });

  const printable = useMemo(() => printableLines(lines), [lines]);
  // Too much text for the size: a warning in the review box, never a block.
  // The cap on a recommended size is taken at the ratio typed on this page (a rectangle is free here), not the design's.
  const { settings } = b;
  const textWarning = useMemo(
    () => textWarningFor(printable, shape, spec, () => maxWidthAtSize(shape, corners, spec, settings.layout)),
    [printable, shape, spec, corners, settings.layout],
  );

  const fail = useCallback((code: AiErrorCode) => {
    setError(code);
    if (isAiOffError(code)) setOff(true);
    if (code === 'ip_limit') setRemainingToday(0);
    // A refused try may have been counted (an unusable custom design): one fewer left.
    if (code === 'refused') setRemainingToday((n) => (n === null ? null : Math.max(0, n - 1)));
  }, []);

  /**
   * «ولّد التصميم»: the idea → the printed lines (spelling fixed) for the review box. The mode stays as it is:
   * only a generation that starts makes it 'ai' (an upload customer who only looks keeps the upload step).
   */
  const review = useCallback(async () => {
    if (busy.current || !shape || !spec || generateBlock({ shape, size: spec, sizeOk, idea, unavailable: off, busy: false })) return;
    busy.current = true;
    setBriefing(true);
    setError(undefined);
    const my = ++token.current;
    const res = await postBrief({ idea: idea.trim(), shape, widthUm: spec.widthUm, heightUm: spec.heightUm });
    busy.current = false;
    if (my !== token.current) return;
    setBriefing(false);
    if (!res.ok) {
      fail(res.error);
      setPhase('idle');
      return;
    }
    brief.current = { visualDescription: res.visualDescription, briefToken: res.briefToken };
    setLinesState(res.lines.slice(0, AI_MAX_LINES).map((l) => l.slice(0, AI_LINE_MAX_CHARS)));
    setFixes(res.fixes);
    setPhase('reviewing');
  }, [shape, spec, sizeOk, idea, off, fail]);

  // What is typed loses the never-printed characters at once; the full clean (spaces, length) is `printable`.
  const setLines = useCallback(
    (l: string[]) => setLinesState(l.slice(0, AI_MAX_LINES).map((x) => typedLine(x).slice(0, AI_LINE_MAX_CHARS))),
    [],
  );

  /** The idea changed: an open review box belongs to the old idea. */
  const onIdeaChange = useCallback(
    (text: string) => {
      b.setIdea(text);
      if (phase === 'reviewing') setPhase('idle');
    },
    [b, phase],
  );

  /** Uploads the reference images not uploaded yet. Returns their ids, or an error code. */
  const uploadRefs = useCallback(async (): Promise<string[] | AiErrorCode> => {
    const ids: string[] = [];
    for (const ref of refsRef.current) {
      const known = refUploads.current.get(ref.key);
      if (known) {
        ids.push(known);
        continue;
      }
      try {
        const up = await uploadWithProgress(ref.file, () => {});
        if (!up.ok) return up.error === 'rate_limited' ? 'rate_limited' : up.error === 'server_error' ? 'failed' : 'invalid_request';
        refUploads.current.set(ref.key, up.uploadId);
        ids.push(up.uploadId);
      } catch {
        return 'network';
      }
    }
    return ids;
  }, []);

  /**
   * Confirm in the review box, «جرّب مرة لخ»: one image from the confirmed lines. Opens the design step.
   * The current (paid) result stays until a new one arrives: a failed try keeps it, with the error above it.
   */
  const generate = useCallback(async () => {
    if (busy.current || !shape || !spec || !brief.current || off) return;
    const sent = printable;
    busy.current = true;
    const my = ++token.current;
    setError(undefined);
    setPhase('generating');
    b.startAi();
    b.showDesignStep();
    const madeFor = { shape, widthUm: spec.widthUm, heightUm: spec.heightUm };

    const refIds = await uploadRefs();
    if (my !== token.current) {
      busy.current = false;
      return;
    }
    if (typeof refIds === 'string') {
      busy.current = false;
      fail(refIds);
      setPhase('error');
      return;
    }
    const res = await postGenerate({
      shape,
      corners,
      widthUm: spec.widthUm,
      heightUm: spec.heightUm,
      idea: idea.trim(),
      visualDescription: brief.current.visualDescription,
      briefToken: brief.current.briefToken,
      lines: sent,
      refUploadIds: refIds,
    });
    busy.current = false;
    if (my !== token.current) return;
    if (!res.ok) {
      fail(res.error);
      setPhase('error');
      return;
    }
    let file: File;
    try {
      file = pngFileFromBase64(res.png);
    } catch {
      fail('network'); // an unreadable answer on this side: the server counted the try
      setPhase('error');
      return;
    }
    replaceResult({
      file,
      uploadId: res.uploadId,
      previewUrl: URL.createObjectURL(file),
      pxWidth: res.pxWidth,
      pxHeight: res.pxHeight,
      lines: sent,
      madeFor,
    });
    setRemainingToday(res.remainingToday);
    setPhase('result');
  }, [b, shape, spec, corners, idea, off, printable, uploadRefs, fail, replaceResult]);

  const retry = generate;

  /** «أكمل بهذا»: the result becomes the order's design; the arrangement step opens. */
  const accept = useCallback(async () => {
    if (!result || busy.current) return;
    if (b.shape !== result.madeFor.shape) return; // the button is disabled then
    busy.current = true;
    const ok = await b.acceptAi(result.file, result.uploadId, result.madeFor, result.lines);
    busy.current = false;
    if (!ok) {
      // The generated PNG did not decode in this browser (should not happen): say so; another try is offered.
      fail('network');
      setPhase('error');
      return;
    }
    replaceResult(undefined);
    // Accepted after a failed retry: that try's message must not come back on page 1.
    setError(undefined);
    setPhase('idle');
  }, [b, result, replaceResult, fail]);

  /** «عدّل الفكرة»: back to the first page (not offered while a try runs: it is counted and its answer is kept). */
  const editIdea = useCallback(() => {
    if (phase === 'generating') return;
    setPhase(brief.current && phase !== 'idle' ? 'reviewing' : 'idle');
    b.goTo(0);
  }, [b, phase]);

  const addRefFiles = useCallback(
    (picked: File[]) => {
      const current = refsRef.current;
      const { files, rejected } = addRefs(
        current.map((r) => r.file),
        picked,
        b.settings.maxUploadBytes,
      );
      setRefRejected(rejected > 0);
      const fresh = files.slice(current.length).map((file) => ({ key: ++refKey.current, file, previewUrl: URL.createObjectURL(file) }));
      if (!fresh.length) return;
      const next = [...current, ...fresh];
      refsRef.current = next;
      setRefs(next);
    },
    [b.settings.maxUploadBytes],
  );

  const removeRef = useCallback((key: number) => {
    const gone = refsRef.current.find((x) => x.key === key);
    revoke(gone?.previewUrl);
    refUploads.current.delete(key);
    const next = refsRef.current.filter((x) => x.key !== key);
    refsRef.current = next;
    setRefs(next);
    setRefRejected(false);
  }, []);

  return {
    phase,
    lines,
    fixes,
    textWarning,
    error,
    result,
    remainingToday,
    /** The site cannot design now (feature off, site limit, blocked): the idea field gives way to a notice. */
    off,
    /** The brief request is running. */
    briefing,
    /** Why «ولّد التصميم» is disabled (null: it may run). */
    block,
    refs,
    refRejected,
    review,
    setLines,
    onIdeaChange,
    generate,
    accept,
    retry,
    editIdea,
    addRefFiles,
    removeRef,
  };
}

export type AiDesignApi = ReturnType<typeof useAiDesign>;
