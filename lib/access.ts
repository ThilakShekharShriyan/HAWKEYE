// Household access gate. One shared token protects every page and API route:
// anyone who can reach the server but does not hold the token gets a 401.

export const ACCESS_COOKIE = "hawkeye_token";
export const ACCESS_HEADER = "x-hawkeye-token";

export type AccessVerdict = "ok" | "denied" | "unconfigured";

/** Constant-time string compare, so the token cannot be guessed by timing. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * Decide whether a request may proceed. With no HAWKEYE_ACCESS_TOKEN set, local
 * development stays open, but a production build refuses to serve anything.
 */
export function checkAccess(
  presented: string | null | undefined,
  expected = process.env.HAWKEYE_ACCESS_TOKEN?.trim(),
  production = process.env.NODE_ENV === "production",
): AccessVerdict {
  if (!expected) return production ? "unconfigured" : "ok";
  return presented && safeEqual(presented, expected) ? "ok" : "denied";
}
