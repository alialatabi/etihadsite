/**
 * Browser fetchers for the AI designer routes (Task 7 contract). Never throw: a network failure or an
 * answer that is not JSON becomes `{ ok: false, error: 'network' }` (a client-side code: the server's
 * 'failed' means "the try was not counted", which the client cannot know). A JSON error answer is returned
 * as it is, whatever its HTTP status.
 */
import type {
  BriefError,
  BriefResponse as ServerBriefResponse,
  GenerateError,
  GenerateRequestBody,
  GenerateResponse as ServerGenerateResponse,
  Shape,
} from '@/lib/types';

export type { BriefError, GenerateError };

export interface BriefRequest {
  idea: string;
  shape: Shape;
  widthUm: number;
  heightUm: number;
}

/** Client-side failure: no usable answer reached the page (the server may still have counted a try). */
export type ClientError = 'network';

export type BriefResponse =
  | Extract<ServerBriefResponse, { ok: true }>
  | { ok: false; error: BriefError | ClientError };

/** ≤ 8 lines, each ≤ 60 characters; ≤ 5 reference upload ids; `instructions` / `instructionsToken` optional (see types.ts). */
export type GenerateRequest = GenerateRequestBody;

export type GenerateResponse =
  | Extract<ServerGenerateResponse, { ok: true }>
  | { ok: false; error: GenerateError | ClientError };

async function post<T extends { ok: boolean }>(url: string, body: unknown): Promise<T | { ok: false; error: ClientError }> {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await r.json()) as unknown;
    if (json && typeof json === 'object' && typeof (json as { ok?: unknown }).ok === 'boolean') return json as T;
    return { ok: false, error: 'network' };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** The two routes a page talks to: the customer builder uses the defaults, the staff page its own. */
export interface AiEndpoints {
  brief: string;
  generate: string;
}

export const DEFAULT_AI_ENDPOINTS: AiEndpoints = { brief: '/api/design/brief', generate: '/api/design/generate' };

export function postBrief(body: BriefRequest, url: string = DEFAULT_AI_ENDPOINTS.brief): Promise<BriefResponse> {
  return post<BriefResponse>(url, body);
}

export function postGenerate(body: GenerateRequest, url: string = DEFAULT_AI_ENDPOINTS.generate): Promise<GenerateResponse> {
  return post<GenerateResponse>(url, body);
}
