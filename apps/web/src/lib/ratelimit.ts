/**
 * Small in-memory rate limiter for the auth routes (one server process in this deployment).
 * Sliding window per key; keys are "<route>:<client ip>". Enough to blunt password guessing
 * and sign-up spam without a store.
 */

const buckets = new Map<string, number[]>();
let sweepAt = Date.now();

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

/** Returns the seconds to wait when over the limit, or 0 when the request may proceed (and counts it). */
export function rateLimit(key: string, limit: number, windowMs: number): number {
  const now = Date.now();
  if (now - sweepAt > 60_000) {
    for (const [k, hits] of buckets) if (hits.every((t) => now - t > windowMs)) buckets.delete(k);
    sweepAt = now;
  }
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000));
  }
  hits.push(now);
  buckets.set(key, hits);
  return 0;
}

/** JSON 429 with a Retry-After header, in Remi's voice. */
export function tooMany(seconds: number): Response {
  const wait = seconds >= 120 ? `${Math.ceil(seconds / 60)} minutes` : seconds >= 60 ? "a minute" : `${seconds} seconds`;
  return Response.json({ error: `Too many tries. Wait ${wait} and try again.` }, { status: 429, headers: { "retry-after": String(seconds) } });
}
