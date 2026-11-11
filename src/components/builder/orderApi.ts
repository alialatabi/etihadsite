import { order } from '@/content/ar';
import type { DirectUploadStart, OrderRequest, OrderResponse, UploadResponse } from '@/lib/types';

/** POST a JSON body and parse the JSON answer; a non-JSON answer throws `<badTag>_<status>`. */
async function postJson<T>(url: string, body: unknown, badTag: string): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  try {
    return (await r.json()) as T;
  } catch {
    throw new Error(`${badTag}_${r.status}`);
  }
}

/**
 * Upload the design. Asks the server first: with cloud storage the file goes straight from
 * the browser to the bucket through a one-time signed URL (hosting caps request bodies at
 * 4.5 MB), then the server checks the stored bytes. With local storage it is the classic
 * multipart POST /api/upload. Rejects on network failure.
 */
export async function uploadWithProgress(file: File, onProgress: (fraction: number) => void): Promise<UploadResponse> {
  const start = await postJson<DirectUploadStart>('/api/upload/direct', { size: file.size, name: file.name }, 'bad_upload_start');
  if (!start.ok) return start;
  if (start.mode === 'server') return xhrSend('POST', '/api/upload', multipart(file), onProgress, true);

  try {
    await xhrSend('PUT', start.url, file, onProgress, false);
  } catch (e) {
    // The bucket refuses files over its limit (413, or 400 with "Payload too large").
    if (e instanceof Error && /^direct_upload_(413|400)$/.test(e.message) && file.size > 0) {
      return { ok: false, error: 'too_large', message: order.errors.too_large };
    }
    throw e;
  }
  return postJson<UploadResponse>('/api/upload/direct/commit', { uploadId: start.uploadId, name: file.name }, 'bad_upload_commit');
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
    xhr.open(method, url);
    xhr.responseType = 'text';
    if (body instanceof File) xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error('network'));
    xhr.ontimeout = () => reject(new Error('timeout'));
    xhr.onload = () => {
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
    };
    xhr.send(body);
  });
}

export async function postOrder(body: OrderRequest): Promise<OrderResponse> {
  return postJson<OrderResponse>('/api/orders', body, 'bad_order_response');
}
