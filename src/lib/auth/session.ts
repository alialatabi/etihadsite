import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { getEnv } from '@/lib/env';
import { COOKIE_NAME, SESSION_TTL_SEC, signToken, verifyToken } from './token';

/** Constant-time password comparison (hashes first so lengths match). */
export function checkPassword(input: string, expected: string = getEnv().ADMIN_PASSWORD): boolean {
  const a = createHash('sha256').update(input).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function createSession(): Promise<void> {
  const token = await signToken(getEnv().SESSION_SECRET);
  const h = await headers();
  // Secure cookies only work over HTTPS; plain http on localhost / LAN must keep working.
  const secure = h.get('x-forwarded-proto') === 'https';
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_TTL_SEC,
  });
}

export async function verifySession(): Promise<boolean> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  return verifyToken(token, process.env.SESSION_SECRET);
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}
