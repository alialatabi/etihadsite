/**
 * The customer's uploaded design file, kept in IndexedDB so a reload (or a closed tab) does not lose it.
 * localStorage cannot hold a file this size. Every call is best effort: without IndexedDB (blocked, private
 * mode, old browser, Node) the functions silently do nothing and `loadDraftFile` answers null.
 */

import { DRAFT_TTL_MS } from './logic';

const DB_NAME = 'ub:draft';
const STORE = 'files';
const KEY = 'design';
/** An open that has not answered after this long counts as failed (some browsers never answer, e.g. private mode). */
const OPEN_TIMEOUT_MS = 3000;

interface DraftFileRecord {
  /** Ties the file to the form that was saved with it (PersistedForm.fileId): tabs share this one slot. */
  id: string;
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (db: IDBDatabase | null) => {
      if (done) {
        db?.close(); // answered after the timeout: nobody is waiting for it
        return;
      }
      done = true;
      clearTimeout(timer);
      resolve(db);
    };
    const timer = setTimeout(() => finish(null), OPEN_TIMEOUT_MS);
    try {
      if (typeof indexedDB === 'undefined') return finish(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        try {
          req.result.createObjectStore(STORE);
        } catch {
          /* the open fails below */
        }
      };
      req.onsuccess = () => finish(req.result);
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
}

/** One transaction with one request; resolves to the request result, or null on any failure. Never rejects. */
async function run<T>(mode: IDBTransactionMode, request: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise<T | null>((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = request(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(req.result);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        resolve(null);
      };
    } catch {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      resolve(null);
    }
  });
}

// A clear that follows a save must run after it: calls are queued in the order they were made.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const p = queue.then(job);
  queue = p.catch(() => undefined);
  return p;
}

/** A stored design file and the id of the form it belongs to. */
export interface DraftFile {
  file: File;
  id: string;
}

/**
 * The file a stored record stands for, or null when the record is junk or older than the draft's lifetime
 * (the file has its own clock so it goes even when the form draft is never read again).
 */
export function draftFileFrom(rec: unknown, now: number): DraftFile | null {
  const r = rec as Partial<DraftFileRecord> | null | undefined;
  if (!r || typeof r !== 'object' || !(r.blob instanceof Blob) || typeof r.id !== 'string' || !r.id) return null;
  if (typeof r.savedAt !== 'number' || !Number.isFinite(r.savedAt) || Math.abs(now - r.savedAt) > DRAFT_TTL_MS) return null;
  try {
    const file = new File([r.blob], typeof r.name === 'string' ? r.name : 'design', {
      type: typeof r.type === 'string' ? r.type : r.blob.type,
      lastModified: typeof r.lastModified === 'number' ? r.lastModified : now,
    });
    return { file, id: r.id };
  } catch {
    return null;
  }
}

/** Stores the original file under `id`, replacing any earlier one. */
export function saveDraftFile(file: File, id: string): Promise<void> {
  return enqueue(async () => {
    try {
      const rec: DraftFileRecord = { id, blob: file, name: file.name, type: file.type, lastModified: file.lastModified, savedAt: Date.now() };
      await run('readwrite', (s) => s.put(rec, KEY));
    } catch {
      /* ignore */
    }
  });
}

/** The stored file with its id, or null (nothing stored, a junk or expired record which is deleted, or no IndexedDB). */
export function loadDraftFile(): Promise<DraftFile | null> {
  return enqueue(async () => {
    try {
      const rec = await run('readonly', (s) => s.get(KEY));
      const found = draftFileFrom(rec, Date.now());
      if (rec && !found) await run('readwrite', (s) => s.delete(KEY));
      return found;
    } catch {
      return null;
    }
  });
}

/** Deletes the stored file; with `ifId` only when it is that form's file (another tab's file stays). */
export function clearDraftFile(ifId?: string): Promise<void> {
  return enqueue(async () => {
    try {
      if (ifId !== undefined) {
        const rec = (await run('readonly', (s) => s.get(KEY))) as Partial<DraftFileRecord> | null;
        if (rec && rec.id !== ifId) return;
      }
      await run('readwrite', (s) => s.delete(KEY));
    } catch {
      /* ignore */
    }
  });
}
