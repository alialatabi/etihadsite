/**
 * Storage path conventions, shared by the routes and both adapters. The same string is a
 * path relative to DATA_DIR for the local adapter and an object key in the bucket for the
 * Supabase one. No imports: scripts load this file through storage/local.ts under tsx.
 */
export const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export const uploadPath = (uploadId: string) => `uploads/${uploadId}.bin`;
export const uploadMetaPath = (uploadId: string) => `uploads/${uploadId}.json`;
export const orderJsonPath = (orderId: string) => `orders/${orderId}.json`;
export const pdfPath = (orderId: string) => `orders/${orderId}.pdf`;
/** The meta file that sits next to a stored design: `uploads/<id>.bin` → `uploads/<id>.json`. */
export const metaPathForDesign = (designPath: string) => designPath.replace(/\.bin$/, '.json');
