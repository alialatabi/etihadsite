'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { decodeDesign } from '@/lib/design/decode.client';
import type { LayoutSettings, QualitySettings } from '@/lib/types';
import {
  MAX_STAFF_FILES,
  MAX_STAFF_FILE_BYTES,
  baseShape,
  canDownload,
  createViewCache,
  staffReducer,
  type StaffShape,
} from './staff-logic';

const revoke = (url: string) => {
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* ignore */
  }
};

/**
 * The staff page's cards: one per picked file. Files are decoded one at a time (a 50 MB file on
 * a phone must not decode next to 29 others), results of a superseded decode are dropped, and
 * every preview object URL is revoked when its card goes away.
 */
export function useStaffItems(layoutSettings: LayoutSettings, quality: QualitySettings) {
  const [cards, dispatch] = useReducer(staffReducer, []);
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
    const next = cards.find((c) => c.status === 'decoding' && !started.current.has(`${c.id}:${c.seq}`));
    if (!next) return;
    started.current.add(`${next.id}:${next.seq}`);
    running.current = true;
    void (async () => {
      let outcome: Awaited<ReturnType<typeof decodeDesign>>;
      try {
        outcome = await decodeDesign(next.file, { shape: baseShape(next.shape).shape, maxBytes: MAX_STAFF_FILE_BYTES });
      } catch {
        outcome = { ok: false, error: 'corrupt' };
      }
      const cur = cardsRef.current.find((c) => c.id === next.id);
      if (!cur || cur.seq !== next.seq) {
        if (outcome.ok) revoke(outcome.source.previewUrl); // removed or superseded while decoding
      } else {
        dispatch({ type: 'decoded', id: next.id, seq: next.seq, outcome });
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
    const room = Math.max(0, MAX_STAFF_FILES - cardsRef.current.length);
    setTooMany(files.length > room);
    const items = files.slice(0, room).map((file) => ({ id: `c${++nextId.current}`, file }));
    if (items.length) dispatch({ type: 'add', items });
  }, []);
  const remove = useCallback((id: string) => {
    setTooMany(false);
    dispatch({ type: 'remove', id });
  }, []);
  const setShape = useCallback((id: string, shape: StaffShape) => dispatch({ type: 'shape', id, shape }), []);
  const setWidth = useCallback((id: string, text: string) => dispatch({ type: 'width', id, text }), []);
  const setHeight = useCallback((id: string, text: string) => dispatch({ type: 'height', id, text }), []);

  const viewOf = useMemo(() => createViewCache(layoutSettings, quality), [layoutSettings, quality]);
  const views = cards.map(viewOf);

  return { cards, views, ready: canDownload(views), tooMany, add, remove, setShape, setWidth, setHeight };
}
