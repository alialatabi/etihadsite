/** Turns any thrown value into an Error for Sentry; shared by report.ts and report.client.ts. Pure. */
export function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);
  try {
    return new Error(`Non-error thrown: ${JSON.stringify(err)}`.slice(0, 300));
  } catch {
    return new Error('Non-error thrown');
  }
}
