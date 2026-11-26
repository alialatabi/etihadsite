import 'server-only';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { normaliseDigits } from '@/lib/parse/digits';

/**
 * Staff passwords: scrypt from node:crypto (no dependency). Stored as `scrypt$N$r$p$saltB64$hashB64`.
 * Hashing is slow on purpose (about 50 ms); only login and the admin's add / reset call it.
 */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;
/** Memory ceiling for one derivation (scrypt needs about 128 * N * r bytes = 16 MB at the defaults). */
const MAXMEM = 64 * 1024 * 1024;

export const STAFF_PASSWORD_MIN = 8;
export const STAFF_PASSWORD_MAX = 200;
/** verifyPassword refuses longer input before any work (a cheap guard against huge bodies). */
const VERIFY_MAX_LEN = 1024;

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const UINT = /^\d+$/;

/** NFC + Arabic-Indic digits to Western, so a password typed on a phone keyboard matches the one the admin set. */
const prep = (pw: string): string => normaliseDigits(pw.normalize('NFC'));

function derive(pw: string, salt: Buffer, keylen: number, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pw, salt, keylen, { N: n, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(prep(pw), salt, KEYLEN, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

const isPow2 = (n: number) => n >= 2 && (n & (n - 1)) === 0;

/** Never throws: anything malformed or unexpected is simply "not a match". */
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  try {
    if (typeof pw !== 'string' || pw.length > VERIFY_MAX_LEN || typeof stored !== 'string') return false;
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, nS, rS, pS, saltS, hashS] = parts;
    if (!UINT.test(nS) || !UINT.test(rS) || !UINT.test(pS)) return false;
    const n = Number(nS);
    const r = Number(rS);
    const p = Number(pS);
    if (!isPow2(n) || n > 2 ** 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;
    if (!B64.test(saltS) || !B64.test(hashS)) return false;
    const salt = Buffer.from(saltS, 'base64');
    const expected = Buffer.from(hashS, 'base64');
    if (salt.length === 0 || expected.length < 16 || expected.length > 128) return false;
    const actual = await derive(prep(pw), salt, expected.length, n, r, p);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | null = null;

/**
 * A valid hash of a random password nobody knows. The login verifies against it when the phone is unknown,
 * so an unknown phone costs the same time as a wrong password. Lazy: never computed at import time.
 */
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(18).toString('base64'));
  return dummy;
}
