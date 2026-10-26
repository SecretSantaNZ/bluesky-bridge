export type RateLimiter = (key: string) => boolean;

type CreateRateLimiterOptions = {
  /** Length of the sliding window in milliseconds. */
  windowMs: number;
  /** Maximum number of calls allowed within the window. */
  max: number;
  /**
   * Maximum number of distinct keys to remember. Once exceeded, expired keys
   * are swept, and if there are still too many, the oldest keys are evicted to
   * keep memory bounded under abuse with random keys.
   */
  maxKeys?: number;
};

/**
 * A simple in-memory sliding window rate limiter. Returns true when the call
 * is allowed and false when the limit for the key has been reached.
 */
export const createRateLimiter = ({
  windowMs,
  max,
  maxKeys = 10_000,
}: CreateRateLimiterOptions): RateLimiter => {
  const hits = new Map<string, number[]>();

  const sweep = (now: number) => {
    for (const [key, times] of hits) {
      const live = times.filter((time) => now - time < windowMs);
      if (live.length === 0) {
        hits.delete(key);
      } else {
        hits.set(key, live);
      }
    }
  };

  return (key: string) => {
    const now = Date.now();
    if (hits.size > maxKeys) {
      sweep(now);
    }
    const live = (hits.get(key) ?? [])
      .filter((time) => now - time < windowMs)
      .slice();
    if (live.length >= max) {
      hits.set(key, live);
      return false;
    }
    if (hits.get(key) == null && hits.size >= maxKeys) {
      // The store is full of live keys, evict the oldest (insertion order) so
      // that abuse with random keys cannot grow the store without bound.
      const oldest = hits.keys().next();
      if (oldest.done !== true) {
        hits.delete(oldest.value);
      }
    }
    live.push(now);
    hits.set(key, live);
    return true;
  };
};

type ClientKeyRequest = {
  headers: Record<string, string | string[] | undefined>;
  ip: string;
};

/**
 * Derives a stable client key for rate limiting.
 *
 * request.ip is the address of the reverse proxy (Caddy) for every request, so
 * it cannot distinguish between clients. The reverse proxy appends the real
 * client address to X-Forwarded-For, and clients can only prepend entries to
 * that header, so the last entry is the one controlled by the proxy. When
 * there is no such header (e.g. local development without a proxy) fall back
 * to the socket address.
 */
export const clientKeyFromRequest = (request: ClientKeyRequest): string => {
  const forwarded = request.headers['x-forwarded-for'];
  const entries = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded)
    ?.split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const last = entries?.at(-1);
  return last ?? request.ip;
};
