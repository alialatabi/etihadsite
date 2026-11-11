/**
 * The upload limit as the whole number of megabytes shown to the customer ({mb} in the copy).
 * Rounded DOWN so the text never promises more than the real limit (15728640 B -> 15).
 */
export function uploadLimitMb(maxUploadBytes: number): number {
  return Math.max(1, Math.floor(maxUploadBytes / (1024 * 1024)));
}
