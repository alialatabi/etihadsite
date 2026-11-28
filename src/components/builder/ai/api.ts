/**
 * Browser fetchers for the AI designer routes (Task 7 contract). Never throw: a network failure or an
 * answer that is not JSON becomes `{ ok: false, error: 'network' }` (a client-side code: the server's
 * 'failed' means "the try was not counted", which the client cannot know). A JSON error answer is returned
 * as it is, whatever its HTTP status.
 */
import { AI_INSTRUCTIONS_MAX_CHARS } from '@/lib/ai/config';
import { capUnits } from '@/lib/ai/sanitize';
import { fetchWithDeadline } from '@/lib/fetch-deadline';
import type { UploadRoutes } from '../orderApi';
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

/** Header deadlines: the routes' maxDuration (brief 60 s, generate 300 s: a long sticker is painted in several calls) plus a margin, so the server has finished or been killed first. */
export const BRIEF_DEADLINE_MS = 75_000;
export const GENERATE_DEADLINE_MS = 330_000;

async function post<T extends { ok: boolean }>(url: string, body: unknown, deadlineMs: number): Promise<T | { ok: false; error: ClientError }> {
  try {
    const r = await fetchWithDeadline(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      deadlineMs,
    );
    const json = (await r.json()) as unknown;
    if (json && typeof json === 'object' && typeof (json as { ok?: unknown }).ok === 'boolean') return json as T;
    return { ok: false, error: 'network' };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** The routes a page talks to: the customer builder uses the defaults, the staff page its own. */
export interface AiEndpoints {
  brief: string;
  generate: string;
  /** Reference-image uploads; absent = the customer routes (limited per IP). */
  upload?: UploadRoutes;
}

export const DEFAULT_AI_ENDPOINTS: AiEndpoints = { brief: '/api/design/brief', generate: '/api/design/generate' };

export function postBrief(body: BriefRequest, url: string = DEFAULT_AI_ENDPOINTS.brief): Promise<BriefResponse> {
  return post<BriefResponse>(url, body, BRIEF_DEADLINE_MS);
}

export function postGenerate(body: GenerateRequest, url: string = DEFAULT_AI_ENDPOINTS.generate): Promise<GenerateResponse> {
  return post<GenerateResponse>(url, body, GENERATE_DEADLINE_MS);
}

const HEX64 = /^[0-9a-f]{64}$/;

/** What the instructions field may hold (the generate route's zod limit). */
export function capInstructions(text: string): string {
  return capUnits(text, AI_INSTRUCTIONS_MAX_CHARS);
}

/** The customer changed the brief's instructions. Emptying the field is not an edit: the server then draws the brief's description. */
export function isInstructionsEdited(text: string, original: string): boolean {
  const t = text.trim();
  return t !== '' && t !== original.trim();
}

/**
 * The optional v2 fields of the generate body. Empty field → none (the signed description is drawn).
 * Unedited → the brief's exact string (its token verifies, no translation); edited → the trimmed text.
 * The token is sent only when it is 64 hex (else zod would refuse the whole body).
 */
export function instructionsFields(
  text: string,
  original: string,
  token: string,
): Pick<GenerateRequest, 'instructions' | 'instructionsToken'> {
  const t = text.trim();
  if (!t) return {};
  const instructions = isInstructionsEdited(text, original) ? t : original;
  return HEX64.test(token) ? { instructions, instructionsToken: token } : { instructions };
}
