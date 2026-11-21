'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AI_LINE_MAX_CHARS, AI_MAX_LINES } from '@/lib/ai/config';
import { textCapacity, type TextCapacity } from '@/lib/ai/text-capacity';
import { generateBlock, type GenerateBlock } from '../logic';
import { uploadWithProgress } from '../orderApi';
import type { BuilderApi } from '../useBuilder';
import { addRefs, isAiOffError, pngFileFromBase64, printableLines, type AiErrorCode } from './ai-logic';
import { postBrief, postGenerate } from './api';

export type AiPhase = 'idle' | 'reviewing' | 'generating' | 'result' | 'error';

export interface AiRef {
  key: number;
  file: File;
  previewUrl: string;
}

export interface AiResultData {
  file: File;
  uploadId: string;
  previewUrl: string;
  /** The lines this image was asked to print. */
  lines: string[];
}

const NO_CAPACITY: TextCapacity = { ok: false, rowsNeeded: 0, rowsAllowed: 0, minSizeUm: null };

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
export function useAiDesign(b: BuilderApi) {
  const [phase, setPhase] = useState<AiPhase>('idle');
  const [lines, setLinesState] = useState<string[]>([]);
  const [fixes, setFixes] = useState<{ from: string; to: string }[]>([]);
  const [error, setError] = useState<AiErrorCode | undefined>(undefined);
  const [result, setResult] = useState<AiResultData | undefined>(undefined);
  const [remainingToday, setRemainingToday] = useState<number | null>(null);
  const [off, setOff] = useState(b.settings.ai?.enabled === false);
  const [briefing, setBriefing] = useState(false);
  const [refs, setRefs] = useState<AiRef[]>([]);
  // The lines printed on the design the customer accepted (memory only: not in the draft).
  const [acceptedLines, setAcceptedLines] = useState<string[] | null>(null);

  const brief = useRef<{ visualDescription: string; briefToken: string } | null>(null);
  const busy = useRef(false);
  const token = useRef(0);
  const refKey = useRef(0);
  const refsRef = useRef<AiRef[]>([]);
  // Upload id of each reference image (by key), so every later try reuses it.
  const refUploads = useRef(new Map<number, string>());
  const resultUrl = useRef<string | undefined>(undefined);

  useEffect(() => {
    refsRef.current = refs;
  }, [refs]);
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
  const block: GenerateBlock | null = generateBlock({ shape, size: spec, sizeOk, idea, unavailable: off, busy: briefing });

  const printable = useMemo(() => printableLines(lines), [lines]);
  const capacity = useMemo<TextCapacity>(
    () => (shape && spec ? textCapacity(printable, shape, spec.widthUm, spec.heightUm) : NO_CAPACITY),
    [printable, shape, spec],
  );

  const fail = useCallback((code: AiErrorCode) => {
    setError(code);
    if (isAiOffError(code)) setOff(true);
    if (code === 'ip_limit') setRemainingToday(0);
    // A refused try may have been counted (an unusable custom design): one fewer left.
    if (code === 'refused') setRemainingToday((n) => (n === null ? null : Math.max(0, n - 1)));
  }, []);

  /** «ولّد التصميم»: the idea → the printed lines (spelling fixed) for the review box. */
  const review = useCallback(async () => {
    if (busy.current || !shape || !spec || generateBlock({ shape, size: spec, sizeOk, idea, unavailable: off, busy: false })) return;
    busy.current = true;
    b.startAi();
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
  }, [b, shape, spec, sizeOk, idea, off, fail]);

  const setLines = useCallback((l: string[]) => setLinesState(l.slice(0, AI_MAX_LINES).map((x) => x.slice(0, AI_LINE_MAX_CHARS))), []);

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
        return 'failed';
      }
    }
    return ids;
  }, []);

  /** Confirm in the review box, «جرّب مرة لخ»: one image from the confirmed lines. Opens the design step. */
  const generate = useCallback(async () => {
    if (busy.current || !shape || !spec || !brief.current || off) return;
    const sent = printable;
    if (!textCapacity(sent, shape, spec.widthUm, spec.heightUm).ok) return;
    busy.current = true;
    const my = ++token.current;
    setError(undefined);
    replaceResult(undefined);
    setPhase('generating');
    b.goTo(1);

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
      fail('failed');
      setPhase('error');
      return;
    }
    replaceResult({ file, uploadId: res.uploadId, previewUrl: URL.createObjectURL(file), lines: sent });
    setRemainingToday(res.remainingToday);
    setPhase('result');
  }, [b, shape, spec, corners, idea, off, printable, uploadRefs, fail, replaceResult]);

  const retry = generate;

  /** «أكمل بهذا»: the result becomes the order's design; the arrangement step opens. */
  const accept = useCallback(async () => {
    if (!result || busy.current) return;
    busy.current = true;
    const ok = await b.acceptAi(result.file, result.uploadId);
    busy.current = false;
    if (!ok) {
      // The generated PNG did not decode (should not happen): say so; another try is offered.
      fail('failed');
      setPhase('error');
      return;
    }
    setAcceptedLines(result.lines);
    replaceResult(undefined);
    setPhase('idle');
  }, [b, result, replaceResult, fail]);

  /** «عدّل الفكرة»: back to the first page. A running try is abandoned (its answer is dropped). */
  const editIdea = useCallback(() => {
    if (phase === 'generating') {
      token.current++;
      busy.current = false;
    }
    setPhase(brief.current && phase !== 'idle' ? 'reviewing' : 'idle');
    b.goTo(0);
  }, [b, phase]);

  const addRefFiles = useCallback(
    (picked: File[]) => {
      const kept = addRefs(
        refsRef.current.map((r) => r.file),
        picked,
        b.settings.maxUploadBytes,
      );
      const fresh = kept.slice(refsRef.current.length).map((file) => ({ key: ++refKey.current, file, previewUrl: URL.createObjectURL(file) }));
      if (fresh.length) setRefs((r) => [...r, ...fresh]);
    },
    [b.settings.maxUploadBytes],
  );

  const removeRef = useCallback((key: number) => {
    setRefs((r) => {
      const gone = r.find((x) => x.key === key);
      revoke(gone?.previewUrl);
      refUploads.current.delete(key);
      return r.filter((x) => x.key !== key);
    });
  }, []);

  return {
    phase,
    lines,
    fixes,
    capacity,
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
    acceptedLines,
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
