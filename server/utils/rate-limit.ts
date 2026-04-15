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

/**
 * Atomic increment + conditional expire + TTL readback.
 * Returns [count, ttlSeconds]. TTL is the authoritative retry-after window.
 */
const ATOMIC_INCR_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
`.trim();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check rate limit for given IP/username key.
 * Uses a single EVAL call so INCR + EXPIRE are guaranteed atomic
 * (prevents the "EXPIRE lost on crash" self-DoS).
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
  const ttlSeconds = Math.ceil(options.duration / 1000);

  const result = (await redis.send("EVAL", [
    ATOMIC_INCR_SCRIPT,
    "1",
    key,
    ttlSeconds.toString(),
  ])) as [number, number];

  const count = result[0];
  const ttl = result[1];
  const retryAfter = ttl > 0 ? ttl : ttlSeconds;

  if (count > options.max) {
    useLogger(event).set({ rateLimit: { exceeded: true, key: keyIdentifier, count } });
    throw new YggdrasilError(
      429,
      "TooManyRequestsException",
      `Too many requests, please try again in ${retryAfter} seconds.`,
    );
  }

  if (count > options.delayAfter) {
    if (options.fastFail) {
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
