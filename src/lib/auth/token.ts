/**
 * Pure JWT helpers (jose HS256). No server-only / next imports so the proxy can use them.
 */
import { SignJWT, jwtVerify } from 'jose';

export const COOKIE_NAME = 'ep_admin';
export const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signToken(secret: string, nowMs: number = Date.now(), ttlSec: number = SESSION_TTL_SEC): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  return new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttlSec)
    .sign(key(secret));
}

export async function verifyToken(token: string | undefined, secret: string | undefined, nowMs: number = Date.now()): Promise<boolean> {
  if (!token || !secret || secret.length < 32) return false;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ['HS256'], currentDate: new Date(nowMs) });
    return payload.role === 'admin';
  } catch {
    return false;
  }
}
