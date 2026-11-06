/** Storage path conventions (relative to DATA_DIR). Shared by routes and the adapter. */
export const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export const uploadPath = (uploadId: string) => `uploads/${uploadId}.bin`;
export const uploadMetaPath = (uploadId: string) => `uploads/${uploadId}.json`;
export const orderJsonPath = (orderId: string) => `orders/${orderId}.json`;
export const pdfPath = (orderId: string) => `orders/${orderId}.pdf`;
