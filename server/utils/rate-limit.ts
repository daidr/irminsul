import type { H3Event } from "h3";
import { useLogger } from "evlog";

export interface RateLimitOptions {
  /** Time window in milliseconds (default: 60000) */
  duration: number;
  /** Maximum requests in window before rejecting with 429 (default: 5) */
  max: number;
  /** Number of requests before progressive delays start (default: 3) */
  delayAfter: number;
  /** Base delay in milliseconds per request after delayAfter (default: 2000) */
  timeWait: number;
  /** If true, reject immediately when over delayAfter instead of progressive delay (default: false) */
  fastFail: boolean;
}

const defaultOptions: RateLimitOptions = {
  duration: 60_000,
  max: 5,
  delayAfter: 3,
  timeWait: 2_000,
  fastFail: false,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check rate limit for given IP/username key.
 * Uses Redis INCR + EXPIRE for distributed, atomic counting.
 * Throws YggdrasilError(429) if exceeded.
 */
export async function checkRateLimit(
  event: H3Event,
  keyIdentifier: string,
  userOptions?: Partial<RateLimitOptions>,
): Promise<void> {
  const options = { ...defaultOptions, ...userOptions };
  const key = buildRedisKey("ratelimit", keyIdentifier);
  const redis = getRedisClient();

  // Atomic increment; returns current count after increment
  const count = (await redis.send("INCR", [key])) as number;

  // Set expiry only on first request in window (when count becomes 1)
  if (count === 1) {
    const ttlSeconds = Math.ceil(options.duration / 1000);
    await redis.send("EXPIRE", [key, ttlSeconds.toString()]);
  }

  // Reject if over max
  if (count > options.max) {
    const ttl = (await redis.send("TTL", [key])) as number;
    const retryAfter = ttl > 0 ? ttl : Math.ceil(options.duration / 1000);
    useLogger(event).set({ rateLimit: { exceeded: true, key: keyIdentifier, count } });
    throw new YggdrasilError(
      429,
      "TooManyRequestsException",
      `Too many requests, please try again in ${retryAfter} seconds.`,
    );
  }

  // Progressive delay or fast-fail after threshold
  if (count > options.delayAfter) {
    if (options.fastFail) {
      const ttl = (await redis.send("TTL", [key])) as number;
      const retryAfter = ttl > 0 ? ttl : Math.ceil(options.duration / 1000);
      useLogger(event).set({ rateLimit: { exceeded: true, key: keyIdentifier, count, fastFail: true } });
      throw new YggdrasilError(
        429,
        "TooManyRequestsException",
        `Too many requests, please try again in ${retryAfter} seconds.`,
      );
    }
    const delay = (count - options.delayAfter) * options.timeWait;
    useLogger(event).set({ rateLimit: { delayed: true, delayMs: delay, key: keyIdentifier } });
    await sleep(delay);
  }
}
