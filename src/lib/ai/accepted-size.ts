/**
 * The sticker size an AI design has once it is accepted. Pure (no I/O): shared by the builder (browser) and the
 * admin designs sheet route (server), so both lay a design out at the very size the customer's order gets.
 */
import { deriveLockedSize } from '@/lib/layout';
import type { Shape } from '@/lib/types';

/**
 * Sticker size after an AI design is accepted. `typed` is the size the design was made for, `aspect` the decoded
 * design's width / height. Custom: the typed size is a square box and the LONGER side of the trimmed design keeps it.
 * Circle and rect: the width is kept and the height follows the image (the aspect lock, as for an upload).
 */
export function aiAcceptedSize(shape: Shape, typed: { widthUm: number; heightUm: number }, aspect: number): { widthUm: number; heightUm: number } {
  if (shape === 'custom' && Number.isFinite(aspect) && aspect > 0 && aspect < 1) {
    return deriveLockedSize(shape, aspect, { heightUm: Math.max(typed.widthUm, typed.heightUm) });
  }
  const side = shape === 'custom' ? Math.max(typed.widthUm, typed.heightUm) : typed.widthUm;
  return deriveLockedSize(shape, aspect, { widthUm: side });
}
