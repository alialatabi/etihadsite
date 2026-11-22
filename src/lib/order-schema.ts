import { z } from 'zod';
import { ID_RE } from '@/lib/storage/paths';
import { MAX_STICKERS_REQUEST } from '@/lib/pricing';
import { MAX_DESIGNS } from '@/config/defaults';

const id = z.string().regex(ID_RE);
const um = z.number().int().min(1).max(400_000);

export const orderRequestSchema = z.object({
  orderId: id,
  uploadId: id,
  spec: z
    .object({
      shape: z.enum(['circle', 'rect', 'custom']),
      corners: z.enum(['rounded', 'sharp']).optional(),
      widthUm: um,
      heightUm: um,
    })
    .refine((s) => s.shape !== 'circle' || s.widthUm === s.heightUm, 'circle must be square'),
  material: z.enum(['paper', 'plastic']),
  // Ranges against settings and the layout are checked in the route (validateStickers / validateQuantity).
  // Sticker count the customer typed (clients since 2026-11-11). When present the server ignores `sheets`.
  stickers: z.number().int().min(1).max(MAX_STICKERS_REQUEST).optional(),
  // Sheet count: the request of older cached pages. At least one of stickers / sheets (refine below).
  sheets: z.number().int().min(1).max(100_000).optional(),
  customer: z.object({
    name: z.string().trim().max(100).optional(),
    phone: z.string().trim().min(5).max(40),
    governorate: z.string().trim().min(1).max(60),
    district: z.string().trim().max(120),
    landmark: z.string().trim().max(200),
    notes: z.string().trim().max(1000).optional(),
    // Optional WhatsApp-offers consent; the page sends it only when ticked. Absent = false.
    marketingOptIn: z.boolean().optional(),
  }),
  turnstileToken: z.string().max(4096).optional(),
  // Multi-design orders only (2..MAX_DESIGNS). Single orders never send it. Cross-checks are in the refines below.
  designs: z.array(z.object({ uploadId: id, widthUm: um, heightUm: um })).min(2).max(MAX_DESIGNS).optional(),
})
  .refine((r) => r.stickers !== undefined || r.sheets !== undefined, { message: 'stickers or sheets is required', path: ['sheets'] })
  .refine((r) => r.designs === undefined || r.stickers !== undefined, {
    message: 'a multi-design order is placed as a sticker count',
    path: ['stickers'],
  })
  .refine(
    (r) =>
      r.designs === undefined ||
      (r.designs[0]?.uploadId === r.uploadId &&
        r.designs[0]?.widthUm === r.spec.widthUm &&
        r.designs[0]?.heightUm === r.spec.heightUm),
    { message: 'designs[0] must be the main design', path: ['designs'] },
  )
  .refine((r) => r.designs === undefined || new Set(r.designs.map((d) => d.uploadId)).size === r.designs.length, {
    message: 'design uploads must be unique',
    path: ['designs'],
  })
  // A circle is square: every design of a circle order too.
  .refine((r) => r.designs === undefined || r.spec.shape !== 'circle' || r.designs.every((d) => d.widthUm === d.heightUm), {
    message: 'circle designs must be square',
    path: ['designs'],
  });

export const clientLogSchema = z.object({
  step: z.enum(['decode', 'preview', 'upload', 'order', 'other']),
  message: z.string().max(1024),
  fileType: z.string().max(200).optional(),
  fileSize: z.number().finite().optional(),
  userAgent: z.string().max(1024).optional(),
});
