/**
 * Shared helpers for the golden (characterisation) suite. Not a test file: vitest only
 * collects `*.test.ts`.
 *
 * These tests pin what the code does TODAY so a behaviour-preserving refactor can be
 * proven. A failing snapshot means behaviour changed: do not update the snapshot unless
 * the change is intended.
 */
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';

/** Recursively sorts object keys so the JSON text does not depend on property order. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
    const o = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, sortKeys(o[k])]),
    );
  }
  return value;
}

/** Canonical JSON: keys sorted at every level, no whitespace. */
export function canon(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** First 16 hex chars of sha256 (64 bits): enough to detect any change, short enough for one line. */
export function sha16(data: string | Uint8Array): string {
  return sha256(data).slice(0, 16);
}

function isInvisible(cp: number): boolean {
  return (
    cp <= 0x08 ||
    (cp >= 0x0b && cp <= 0x1f) || // includes \r; \t and \n stay literal
    cp === 0x7f ||
    cp === 0xa0 ||
    cp === 0xad ||
    cp === 0x61c ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x2028 && cp <= 0x202f) ||
    (cp >= 0x2060 && cp <= 0x2069) ||
    cp === 0xfeff
  );
}

/**
 * Lossless, readable encoding of invisible characters (bidi marks, NBSP, BOM, CR, …) as
 * `<U+XXXX>`. Needed because the snapshot machinery folds `\r\n` into `\n`, and because an
 * invisible character lost in a refactor would otherwise produce an unreadable diff.
 */
export function visible(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    out += isInvisible(cp) ? `<U+${cp.toString(16).toUpperCase().padStart(4, '0')}>` : ch;
  }
  return out;
}

/** `visible()` applied to every string inside a JSON-like value. */
export function visibleDeep<T>(value: T): T {
  if (typeof value === 'string') return visible(value) as unknown as T;
  if (Array.isArray(value)) return value.map(visibleDeep) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, visibleDeep(v)])) as T;
  }
  return value;
}

/** Compact one-line rendering of a value for table rows (`undefined`, NaN and ±Infinity stay distinguishable). */
export function show(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return JSON.stringify(visible(value));
  return visible(
    JSON.stringify(value, (_k, v: unknown) => {
      if (v === undefined) return '<undefined>';
      if (typeof v === 'number' && !Number.isFinite(v)) return `<${String(v)}>`;
      return v;
    }),
  );
}

const tempDirs: string[] = [];

/** Remembers a temp directory a test created (mkdtemp under the OS temp dir) for removeTempDirs(). */
export function track(dir: string): string {
  tempDirs.push(dir);
  return dir;
}

/** Best-effort removal of every tracked temp directory. Call from afterAll(). */
export function removeTempDirs(): void {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort: a leftover temp dir is harmless */
    }
  }
}
