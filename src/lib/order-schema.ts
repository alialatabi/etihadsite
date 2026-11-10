import { z } from 'zod';
import { ID_RE } from '@/lib/storage/paths';

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
  // Range against settings (min/max sheets) is checked in the route with validateQuantity().
  sheets: z.number().int().min(1).max(100_000),
  customer: z.object({
    name: z.string().trim().max(100).optional(),
    phone: z.string().trim().min(5).max(40),
    governorate: z.string().trim().min(1).max(60),
    district: z.string().trim().max(120),
    landmark: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(1000).optional(),
  }),
  turnstileToken: z.string().max(4096).optional(),
});

export const clientLogSchema = z.object({
  step: z.enum(['decode', 'preview', 'upload', 'order', 'other']),
  message: z.string().max(1024),
  fileType: z.string().max(200).optional(),
  fileSize: z.number().finite().optional(),
  userAgent: z.string().max(1024).optional(),
});
