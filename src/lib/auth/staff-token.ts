/**
 * Pure JWT helpers for the staff designer session (jose HS256). No server-only / next imports,
 * same style as ./token.ts. Admin and staff tokens share SESSION_SECRET, so the `role` claim is
 * the only thing separating them: token.ts accepts only 'admin', this file only 'staff'.
 */
import { SignJWT, jwtVerify } from 'jose';

export const STAFF_COOKIE_NAME = 'sf_staff';
export const STAFF_SESSION_TTL_SEC = 7 * 24 * 60 * 60;

/** Same pattern as ID_RE in storage/paths.ts, inlined to keep this file import-free. */
const SUB_RE = /^[A-Za-z0-9_-]{8,64}$/;

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signStaffToken(
  secret: string,
  staffId: string,
  nowMs: number = Date.now(),
  ttlSec: number = STAFF_SESSION_TTL_SEC,
): Promise<string> {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET too short');
  // Same placeholder rule as env.ts (inlined: this file stays import-free for the proxy).
  if (secret.toLowerCase().startsWith('change-me')) throw new Error('SESSION_SECRET is a placeholder');
  if (typeof staffId !== 'string' || !SUB_RE.test(staffId)) throw new Error('Invalid staff id');
  const iat = Math.floor(nowMs / 1000);
  return new SignJWT({ role: 'staff' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(staffId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttlSec)
    .sign(key(secret));
}

export async function verifyStaffToken(
  token: string | undefined,
  secret: string | undefined,
  nowMs: number = Date.now(),
): Promise<{ staffId: string; iatSec: number } | null> {
  if (!token || !secret || secret.length < 32) return null;
  if (secret.toLowerCase().startsWith('change-me')) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ['HS256'], currentDate: new Date(nowMs) });
    if (payload.role !== 'staff') return null;
    const sub = payload.sub;
    if (typeof sub !== 'string' || !SUB_RE.test(sub)) return null;
    if (typeof payload.iat !== 'number' || !Number.isInteger(payload.iat)) return null;
    return { staffId: sub, iatSec: payload.iat };
  } catch {
    return null;
  }
}
