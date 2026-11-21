/** Test helpers for the AI design routes: real PNGs made with sharp and a stubbed OpenAI. */
import sharp from "sharp";
import { vi } from "vitest";

export const OPENAI_BASE = "http://openai.test";

/** Opaque RGB PNG (circle/rect output). */
export async function opaquePng(w = 64, h = 64): Promise<Uint8Array> {
  const buf = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 80, b: 40 } } })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

/**
 * RGBA PNG like the image model's custom output: a subject at alpha 253 (never 255) on a fully
 * transparent background whose RGB is dark.
 */
export async function modelCustomPng(w = 64, h = 64, subject = { left: 20, top: 16, width: 24, height: 30 }): Promise<Uint8Array> {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inside = x >= subject.left && x < subject.left + subject.width && y >= subject.top && y < subject.top + subject.height;
      if (inside) {
        data[i] = 230;
        data[i + 1] = 40;
        data[i + 2] = 90;
        data[i + 3] = 253;
      } else {
        data[i] = 3;
        data[i + 1] = 3;
        data[i + 2] = 3;
        data[i + 3] = 0;
      }
    }
  }
  const buf = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  return new Uint8Array(buf);
}

/** RGBA PNG with every pixel at alpha 254: the model ignored "transparent background". */
export async function opaqueRgbaPng(w = 64, h = 64): Promise<Uint8Array> {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 120;
    data[i + 1] = 200;
    data[i + 2] = 60;
    data[i + 3] = 254;
  }
  const buf = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  return new Uint8Array(buf);
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function imageResponse(png: Uint8Array): Response {
  return jsonResponse({ data: [{ b64_json: Buffer.from(png).toString("base64") }] });
}

export function briefResponse(answer: {
  printed_text: string[];
  visual_description: string;
  spelling_fixes: { from: string; to: string }[];
}): Response {
  return jsonResponse({
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }],
  });
}

export interface OpenAiCall {
  path: string;
  /** JSON body (string) or the entries of a multipart body. */
  body: unknown;
  /** Every text in the body, joined: JSON text, or every string field and file name of a form. */
  text: string;
}

/**
 * Stubs global fetch. `handler(path)` answers each call (path relative to OPENAI_BASE, e.g.
 * '/images/generations'). Every call is recorded with its body for later inspection.
 */
export function stubOpenAi(handler: (path: string) => Response | Promise<Response>): OpenAiCall[] {
  const calls: OpenAiCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (!u.startsWith(OPENAI_BASE)) throw new Error(`unexpected fetch ${u}`);
      const path = u.slice(OPENAI_BASE.length);
      const raw = init?.body;
      if (raw instanceof FormData) {
        const parts: string[] = [];
        const entries: [string, string][] = [];
        for (const [k, v] of raw.entries()) {
          if (typeof v === "string") {
            parts.push(v);
            entries.push([k, v]);
          } else {
            parts.push(v.name, new TextDecoder().decode(new Uint8Array(await v.arrayBuffer())));
            entries.push([k, `file:${v.name}:${v.type}`]);
          }
        }
        calls.push({ path, body: entries, text: parts.join("\n") });
      } else {
        const text = typeof raw === "string" ? raw : "";
        calls.push({ path, body: text ? JSON.parse(text) : undefined, text });
      }
      return handler(path);
    }),
  );
  return calls;
}
