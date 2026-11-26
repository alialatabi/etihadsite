'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { decodeDesign } from '@/lib/design/decode.client';
import { reportClientError } from '@/lib/monitoring/report.client';
import type { ReceiptFormat, ReceiptWhite } from '@/lib/receipts/formats';
import type { QualitySettings } from '@/lib/types';
import { MAX_RECEIPT_FILES, MAX_RECEIPT_FILE_BYTES, canDownload, createViewCache, receiptReducer } from './receipt-logic';

const revoke = (url: string) => {
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* ignore */
  }
};

/**
 * The receipts tab's cards: one per picked file. Files are decoded one at a time (a 50 MB file on
 * a phone must not decode next to 29 others), the answer for a card that was removed meanwhile is
 * dropped, and every preview object URL is revoked when its card goes away.
 */
export function useReceiptItems(quality: QualitySettings) {
  const [cards, dispatch] = useReducer(receiptReducer, []);
  const [tick, setTick] = useState(0);
  const [tooMany, setTooMany] = useState(false);

  const cardsRef = useRef(cards);
  const started = useRef(new Set<string>());
  const running = useRef(false);
  const nextId = useRef(0);
  const urls = useRef(new Set<string>());

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  /* ── decode queue: one file at a time ── */
  useEffect(() => {
    if (running.current) return;
    const next = cards.find((c) => c.status === 'decoding' && !started.current.has(c.id));
    if (!next) return;
    started.current.add(next.id);
    running.current = true;
    void (async () => {
      let outcome: Awaited<ReturnType<typeof decodeDesign>>;
      try {
        outcome = await decodeDesign(next.file, { shape: 'rect', maxBytes: MAX_RECEIPT_FILE_BYTES });
      } catch (e) {
        reportClientError(e, { where: 'staff.receipts.decode', extra: { fileSize: next.file.size } });
        outcome = { ok: false, error: 'corrupt' };
      }
      if (!cardsRef.current.some((c) => c.id === next.id)) {
        if (outcome.ok) revoke(outcome.source.previewUrl); // removed while decoding
      } else {
        dispatch({ type: 'decoded', id: next.id, outcome });
      }
      running.current = false;
      setTick((t) => t + 1); // look for the next file
    })();
  }, [cards, tick]);

  /* ── object URL hygiene ── */
  useEffect(() => {
    const live = new Set<string>();
    for (const c of cards) if (c.design) live.add(c.design.previewUrl);
    for (const u of urls.current) if (!live.has(u)) revoke(u);
    urls.current = live;
  }, [cards]);
  useEffect(
    () => () => {
      for (const u of urls.current) revoke(u);
    },
    [],
  );

  const add = useCallback((files: File[]) => {
    if (!files.length) return;
    const room = Math.max(0, MAX_RECEIPT_FILES - cardsRef.current.length);
    setTooMany(files.length > room);
    const items = files.slice(0, room).map((file) => ({ id: `r${++nextId.current}`, file }));
    if (items.length) dispatch({ type: 'add', items });
  }, []);
  const remove = useCallback((id: string) => {
    setTooMany(false);
    dispatch({ type: 'remove', id });
  }, []);
  const setFormat = useCallback((id: string, format: ReceiptFormat) => dispatch({ type: 'format', id, format }), []);
  const turn = useCallback((id: string) => dispatch({ type: 'turn', id }), []);
  const setWhite = useCallback((id: string, white: ReceiptWhite) => dispatch({ type: 'white', id, white }), []);

  const viewOf = useMemo(() => createViewCache(quality), [quality]);
  const views = cards.map(viewOf);

  return { cards, views, ready: canDownload(views), tooMany, add, remove, setFormat, turn, setWhite };
}
