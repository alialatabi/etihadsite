import "server-only";

/**
 * Asks Cloudflare Turnstile whether `token` is valid for this secret. False for a missing
 * token, a refusal, and any network, timeout or parse failure (never throws).
 * Only POST /api/orders calls it, and only when TURNSTILE_SECRET_KEY is set; the site has
 * no client widget yet, so with a secret configured every order is refused.
 */
export async function verifyTurnstile(
  secret: string,
  token: string | undefined,
  ip: string,
): Promise<boolean> {
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token, remoteip: ip });
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body,
        signal: AbortSignal.timeout(10_000),
      },
    );
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}
