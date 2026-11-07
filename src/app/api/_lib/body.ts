/** Byte-capped request body reading, so oversize/chunked bodies are never fully buffered. */

export class BodyTooLarge extends Error {}

/** Declared Content-Length: a non-negative integer, or null when absent/invalid. */
export function declaredLength(request: Request): number | null {
  const raw = request.headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  return Number(raw);
}

/** Reads the body, aborting as soon as more than `max` bytes arrive. Throws BodyTooLarge. */
export async function readCapped(
  request: Request,
  max: number,
): Promise<Uint8Array> {
  const declared = declaredLength(request);
  if (declared !== null && declared > max) throw new BodyTooLarge();
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** Parses a JSON body with a byte cap. Throws BodyTooLarge, or SyntaxError for bad JSON. */
export async function readJsonCapped(
  request: Request,
  max: number,
): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await readCapped(request, max)));
}
