import { order } from '@/content/ar';
import { fetchWithDeadline } from '@/lib/fetch-deadline';
import type { DirectUploadStart, OrderRequest, OrderResponse, UploadResponse } from '@/lib/types';

/** How long a JSON POST may wait for the server's answer (headers); the routes' own cap is 60 s. */
export const POST_DEADLINE_MS = 75_000;

/** A direct upload that sends no progress for this long is dead; a slow but moving upload is never cut. */
const UPLOAD_STALL_MS = 60_000;
/** After the last byte left, how long the receiver may take to acknowledge. */
const UPLOAD_RESPONSE_MS = 45_000;

/** POST a JSON body and parse the JSON answer; a non-JSON answer throws `<badTag>_<status>`; no answer within 75 s throws `timeout`. */
async function postJson<T>(url: string, body: unknown, badTag: string): Promise<T> {
  const r = await fetchWithDeadline(
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    POST_DEADLINE_MS,
  );
  try {
    return (await r.json()) as T;
  } catch {
    throw new Error(`${badTag}_${r.status}`);
  }
}

/** The three upload routes: the customer ones by default, the staff page passes its own (per-account limits). */
export interface UploadRoutes {
  start: string;
  commit: string;
  server: string;
}
export const DEFAULT_UPLOAD_ROUTES: UploadRoutes = {
  start: '/api/upload/direct',
  commit: '/api/upload/direct/commit',
  server: '/api/upload',
};

/**
 * Upload the design. Asks the server first: with cloud storage the file goes straight from
 * the browser to the bucket through a one-time signed URL (hosting caps request bodies at
 * 4.5 MB), then the server checks the stored bytes. With local storage it is the classic
 * multipart POST /api/upload. Rejects on network failure.
 */
export async function uploadWithProgress(
  file: File,
  onProgress: (fraction: number) => void,
  routes: UploadRoutes = DEFAULT_UPLOAD_ROUTES,
): Promise<UploadResponse> {
  const start = await postJson<DirectUploadStart>(routes.start, { size: file.size, name: file.name }, 'bad_upload_start');
  if (!start.ok) return start;
  if (start.mode === 'server') return xhrSend('POST', routes.server, multipart(file), onProgress, true);

  try {
    await xhrSend('PUT', start.url, file, onProgress, false);
  } catch (e) {
    // The bucket refuses files over its limit (413, or 400 with "Payload too large").
    if (e instanceof Error && /^direct_upload_(413|400)$/.test(e.message) && file.size > 0) {
      return { ok: false, error: 'too_large', message: order.errors.too_large };
    }
    throw e;
  }
  return postJson<UploadResponse>(routes.commit, { uploadId: start.uploadId, name: file.name }, 'bad_upload_commit');
}

function multipart(file: File): FormData {
  const form = new FormData();
  form.append('file', file, file.name);
  return form;
}

/** XHR (not fetch) so the browser reports upload progress. */
function xhrSend(
  method: 'POST' | 'PUT',
  url: string,
  body: FormData | File,
  onProgress: (fraction: number) => void,
  parseJson: true,
): Promise<UploadResponse>;
function xhrSend(method: 'POST' | 'PUT', url: string, body: FormData | File, onProgress: (fraction: number) => void, parseJson: false): Promise<void>;
function xhrSend(
  method: 'POST' | 'PUT',
  url: string,
  body: FormData | File,
  onProgress: (fraction: number) => void,
  parseJson: boolean,
): Promise<UploadResponse | void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const clear = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    /** Run the outcome exactly once and stop the watchdog. */
    const settle = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clear();
      outcome();
    };
    /** (Re)start the countdown; when it runs out the request is given up on. */
    const arm = (ms: number) => {
      clear();
      timer = setTimeout(() => {
        settle(() => reject(new Error('timeout')));
        xhr.abort();
      }, ms);
    };
    xhr.open(method, url);
    xhr.responseType = 'text';
    if (body instanceof File) xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      arm(UPLOAD_STALL_MS);
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.upload.onload = () => arm(UPLOAD_RESPONSE_MS);
    xhr.onerror = () => settle(() => reject(new Error('network')));
    xhr.onabort = () => settle(() => reject(new Error('network')));
    xhr.ontimeout = () => settle(() => reject(new Error('timeout')));
    xhr.onload = () =>
      settle(() => {
        if (!parseJson) {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`direct_upload_${xhr.status}`));
          return;
        }
        try {
          resolve(JSON.parse(xhr.responseText) as UploadResponse);
        } catch {
          reject(new Error(`bad_upload_response_${xhr.status}`));
        }
      });
    arm(UPLOAD_STALL_MS);
    xhr.send(body);
  });
}

export async function postOrder(body: OrderRequest): Promise<OrderResponse> {
  return postJson<OrderResponse>('/api/orders', body, 'bad_order_response');
}
