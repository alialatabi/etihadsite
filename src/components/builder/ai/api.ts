/**
 * Browser fetchers for the AI designer routes (Task 7 contract). Never throw: a network failure or an
 * answer that is not JSON becomes `{ ok: false, error: 'failed' }`. A JSON error answer is returned as it is,
 * whatever its HTTP status.
 */
import type { Corners, Shape } from '@/lib/types';

export interface BriefRequest {
  idea: string;
  shape: Shape;
  widthUm: number;
  heightUm: number;
}

export type BriefError = 'unavailable' | 'rate_limited' | 'invalid_request' | 'failed';
export type BriefResponse =
  | { ok: true; lines: string[]; fixes: { from: string; to: string }[]; visualDescription: string; briefToken: string }
  | { ok: false; error: BriefError };

export interface GenerateRequest {
  shape: Shape;
  corners: Corners;
  widthUm: number;
  heightUm: number;
  idea: string;
  visualDescription: string;
  briefToken: string;
  /** ≤ 8 lines, each ≤ 60 characters. */
  lines: string[];
  /** ≤ 5 upload ids of the reference images. */
  refUploadIds: string[];
}

export type GenerateError = 'unavailable' | 'blocked' | 'ip_limit' | 'site_limit' | 'text_too_long' | 'refused' | 'failed' | 'invalid_request';
export type GenerateResponse =
  | { ok: true; uploadId: string; png: string; pxWidth: number; pxHeight: number; remainingToday: number | null }
  | { ok: false; error: GenerateError };

async function post<T extends { ok: boolean }>(url: string, body: unknown): Promise<T | { ok: false; error: 'failed' }> {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await r.json()) as unknown;
    if (json && typeof json === 'object' && typeof (json as { ok?: unknown }).ok === 'boolean') return json as T;
    return { ok: false, error: 'failed' };
  } catch {
    return { ok: false, error: 'failed' };
  }
}

export function postBrief(body: BriefRequest): Promise<BriefResponse> {
  return post<BriefResponse>('/api/design/brief', body);
}

export function postGenerate(body: GenerateRequest): Promise<GenerateResponse> {
  return post<GenerateResponse>('/api/design/generate', body);
}
