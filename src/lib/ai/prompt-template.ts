import 'server-only';
import type { Corners, Shape } from '../types';
import { AI_LINE_MAX_CHARS, AI_MAX_ASPECT, AI_MIN_PIXELS, AI_IMAGE_LONG_SIDE } from './config';

export interface TemplateInput {
  shape: Shape;
  corners: Corners;
  widthUm: number;
  heightUm: number;
  visualDescription: string;
  lines: string[];
  hasRefs: boolean;
}

/** Removes « » " ' ` < >, control characters and newlines, collapses spaces, trims, cuts to the line limit. */
export function sanitizeLine(line: string): string {
  const cleaned = line
    .replace(/[\p{Cc}\u{2028}\u{2029}]/gu, ' ')
    .replace(/[«»"'`<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, AI_LINE_MAX_CHARS).join('').trim();
}

const cm = (um: number): string => (um / 10_000).toFixed(1);

function shapeRule(shape: Shape, corners: Corners): string {
  if (shape === 'circle') {
    return 'The sticker is a circle inscribed in the canvas: draw the artwork as a circle touching the canvas edges, and leave everything outside the circle fully transparent.';
  }
  if (shape === 'rect') {
    const base =
      'The sticker is a rectangle: fill the whole canvas edge to edge with the artwork, with no border and no bleed.';
    return corners === 'rounded'
      ? `${base} The sticker has rounded corners, so keep important content away from the corners.`
      : base;
  }
  return 'The sticker is die-cut around the subject: use a transparent background and draw one continuous smooth thick white border around the whole subject (about 3% of the canvas width).';
}

/** Builds the fixed prompt sent to the image model. Customer text only enters through `visualDescription` and `lines`. */
export function buildImagePrompt(input: TemplateInput): string {
  const { shape, corners, widthUm, heightUm, visualDescription, hasRefs } = input;
  const lines = input.lines.map(sanitizeLine).filter((l) => l.length > 0);
  const parts: string[] = [];

  parts.push('You are a professional sticker designer creating print-ready artwork for a sticker.');
  parts.push(shapeRule(shape, corners));
  parts.push(`Final printed size: ${cm(widthUm)} cm × ${cm(heightUm)} cm.`);
  parts.push(`Artwork: ${visualDescription}`);
  if (hasRefs) {
    parts.push(
      'Use the attached reference images as visual guidance for the subject, colours and style of the artwork.',
    );
  }

  if (lines.length === 0) {
    parts.push('Do not add any text, letters or numbers.');
  } else {
    const numbered = lines.map((l, i) => `${i + 1}. «${l}»`).join('\n');
    parts.push(
      `Write exactly these lines of text, letter for letter, with no changes, no additions and no missing letters. Each line is the text between « and »; do not print the « » marks themselves:\n${numbered}`,
    );
    const percent = Math.ceil(300_000 / Math.min(widthUm, heightUm));
    parts.push(
      `All text must be large and clearly readable: the height of the text must be at least ${percent}% of the canvas's shorter side.`,
    );
  }

  parts.push(
    'Use bright, vivid colours. Avoid very dark colours, large black areas, and black or near-black gradients.',
  );
  parts.push(
    'Style: clean vector-like artwork with bold shapes and no tiny details. No watermark, no signature, no frame. This is the flat artwork itself, not a mockup.',
  );
  return parts.join('\n\n');
}

/** Rectangles must not be more than AI_MAX_ASPECT times longer than wide; other shapes always pass. */
export function aiAspectOk(shape: Shape, widthUm: number, heightUm: number): boolean {
  if (shape !== 'rect') return true;
  const long = Math.max(widthUm, heightUm);
  const short = Math.min(widthUm, heightUm);
  return long / short <= AI_MAX_ASPECT;
}

/** Image size to request (multiples of 16, enough pixels) and whether the background is transparent. */
export function imageRequestSize(
  shape: Shape,
  widthUm: number,
  heightUm: number,
): { size: string; background: 'transparent' | 'opaque' } {
  if (shape !== 'rect') return { size: '1024x1024', background: 'transparent' };
  const long = Math.max(widthUm, heightUm);
  const short = Math.min(widthUm, heightUm);
  const r = long / short;
  let l = AI_IMAGE_LONG_SIDE;
  let s = Math.round(l / r / 16) * 16;
  while (l * s < AI_MIN_PIXELS) {
    l += 16;
    s = Math.round(l / r / 16) * 16;
  }
  const size = widthUm >= heightUm ? `${l}x${s}` : `${s}x${l}`;
  return { size, background: 'opaque' };
}
