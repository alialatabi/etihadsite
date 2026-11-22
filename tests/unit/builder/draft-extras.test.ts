/**
 * The IndexedDB side of the extra designs: design 1 keeps the key 'design', the others live under 'design:<fileId>',
 * and clearing the draft file clears the extras too. A tiny in-memory IndexedDB stands in for the browser's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearDraftExtraFile,
  clearDraftExtraFiles,
  clearDraftFile,
  extraDraftKey,
  loadDraftExtraFile,
  loadDraftFile,
  saveDraftExtraFile,
  saveDraftFile,
} from '@/components/builder/draft-store';
import { markOrderNoteSeen, orderNoteKey, shouldShowOrderNote } from '@/components/builder/order-note';

type Key = string | { lo: string; hi: string };

function installFakeIndexedDb() {
  const data = new Map<string, unknown>();
  const inRange = (k: string, key: Key) => (typeof key === 'string' ? k === key : k >= key.lo && k <= key.hi);
  const db = {
    close: () => {},
    transaction: () => {
      const tx: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; objectStore: () => unknown } = {
        objectStore: () => ({
          put: (rec: unknown, key: string) => {
            data.set(key, rec);
            queueMicrotask(() => tx.oncomplete?.());
            return { result: key };
          },
          get: (key: string) => {
            const req = { result: data.get(key) };
            queueMicrotask(() => tx.oncomplete?.());
            return req;
          },
          delete: (key: Key) => {
            for (const k of [...data.keys()]) if (inRange(k, key)) data.delete(k);
            queueMicrotask(() => tx.oncomplete?.());
            return { result: undefined };
          },
        }),
      };
      return tx;
    },
  };
  vi.stubGlobal('indexedDB', {
    open: () => {
      const req: { result: unknown; onupgradeneeded?: () => void; onsuccess?: () => void } = { result: { ...db, createObjectStore: () => {} } };
      queueMicrotask(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  });
  vi.stubGlobal('IDBKeyRange', { bound: (lo: string, hi: string) => ({ lo, hi }) });
  return data;
}

const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png', lastModified: 7 });

describe('draft files of a multi-design order', () => {
  let data: Map<string, unknown>;
  beforeEach(() => {
    data = installFakeIndexedDb();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('design 1 keeps the key "design"; each extra gets "design:<fileId>"', async () => {
    await saveDraftFile(file('one.png'), 'main1');
    await saveDraftExtraFile(file('two.png'), 'x2');
    await saveDraftExtraFile(file('three.png'), 'x3');
    expect([...data.keys()].sort()).toEqual(['design', 'design:x2', 'design:x3']);
    expect(extraDraftKey('x2')).toBe('design:x2');

    expect((await loadDraftFile())?.file.name).toBe('one.png');
    const two = await loadDraftExtraFile('x2');
    expect([two?.id, two?.file.name]).toEqual(['x2', 'two.png']);
    expect(await loadDraftExtraFile('nope')).toBeNull();
  });

  it('an extra stored under another id is not handed back', async () => {
    await saveDraftExtraFile(file('two.png'), 'x2');
    // a record that claims another id under this key (another tab overwrote it)
    const rec = data.get('design:x2') as { id: string };
    data.set('design:x2', { ...rec, id: 'other' });
    expect(await loadDraftExtraFile('x2')).toBeNull();
  });

  it('clearDraftFile clears design 1 AND every extra', async () => {
    await saveDraftFile(file('one.png'), 'main1');
    await saveDraftExtraFile(file('two.png'), 'x2');
    await saveDraftExtraFile(file('three.png'), 'x3');
    await clearDraftFile();
    expect([...data.keys()]).toEqual([]);
  });

  it('clearDraftFile(ifId) leaves another tab\'s files alone, and clears all of this form\'s', async () => {
    await saveDraftFile(file('one.png'), 'main1');
    await saveDraftExtraFile(file('two.png'), 'x2');
    await clearDraftFile('someone-else');
    expect([...data.keys()].sort()).toEqual(['design', 'design:x2']);
    await clearDraftFile('main1');
    expect([...data.keys()]).toEqual([]);
  });

  it('clearDraftExtraFile removes one extra; clearDraftExtraFiles all extras but design 1', async () => {
    await saveDraftFile(file('one.png'), 'main1');
    await saveDraftExtraFile(file('two.png'), 'x2');
    await saveDraftExtraFile(file('three.png'), 'x3');
    await clearDraftExtraFile('x2');
    expect([...data.keys()].sort()).toEqual(['design', 'design:x3']);
    await clearDraftExtraFiles();
    expect([...data.keys()]).toEqual(['design']);
  });

  it('an expired extra is deleted when it is read', async () => {
    await saveDraftExtraFile(file('two.png'), 'x2');
    const rec = data.get('design:x2') as { savedAt: number };
    data.set('design:x2', { ...rec, savedAt: Date.now() - 3 * 60 * 60 * 1000 });
    expect(await loadDraftExtraFile('x2')).toBeNull();
    expect(data.has('design:x2')).toBe(false);
  });
});

describe('the success popup is shown once per order', () => {
  const fakeStore = () => {
    const m = new Map<string, string>();
    return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it('shows until the customer closes it, per order number', () => {
    const s = fakeStore();
    expect(shouldShowOrderNote('EP-1', s)).toBe(true);
    markOrderNoteSeen('EP-1', s);
    expect(shouldShowOrderNote('EP-1', s)).toBe(false);
    expect(shouldShowOrderNote('EP-2', s)).toBe(true); // another order shows it again
    expect([...s.m.keys()]).toEqual([orderNoteKey('EP-1')]);
    expect(orderNoteKey('EP-1').startsWith('ub:')).toBe(true);
  });

  it('works without storage: it simply shows', () => {
    expect(shouldShowOrderNote('EP-1', null)).toBe(true);
    expect(() => markOrderNoteSeen('EP-1', null)).not.toThrow();
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(shouldShowOrderNote('EP-1', broken)).toBe(true);
    expect(() => markOrderNoteSeen('EP-1', broken)).not.toThrow();
  });
});
