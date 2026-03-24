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
  /** Maximum number of tracked keys before rejecting new entries (default: 10000) */
  maxKeys: number;
}

const defaultOptions: RateLimitOptions = {
  duration: 60_000,
  max: 5,
  delayAfter: 3,
  timeWait: 2_000,
  maxKeys: 10_000,
};

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Periodic cleanup of expired entries
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now >= entry.resetAt) {
      store.delete(key);
    }
  }
}, defaultOptions.duration);
cleanupInterval.unref();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check rate limit for given IP/username key.
 * Throws YggdrasilError(429) if exceeded.
 */
export async function checkRateLimit(
  keyIdentifier: string,
  userOptions?: Partial<RateLimitOptions>,
): Promise<void> {
  const options = { ...defaultOptions, ...userOptions };
  const key = `yggdrasil:auth-limit|${keyIdentifier}`;
  const now = Date.now();

  let entry = store.get(key);

  // Reset entry if window has expired
  if (!entry || now >= entry.resetAt) {
    // Reject new keys when store is at capacity
    if (!entry && store.size >= options.maxKeys) {
      useLogger().set({ rateLimit: { warning: "store_full", storeSize: store.size, key } });
      throw new YggdrasilError(
        429,
        "TooManyRequestsException",
        "Server is under heavy load, please try again later.",
      );
    }
    entry = { count: 0, resetAt: now + options.duration };
    store.set(key, entry);
  }

  entry.count++;

  // Reject if over max
  if (entry.count > options.max) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    useLogger().set({ rateLimit: { exceeded: true, key } });
    throw new YggdrasilError(
      429,
      "TooManyRequestsException",
      `Too many requests, please try again in ${retryAfter} seconds.`,
    );
  }

  // Progressive delay after threshold
  if (entry.count > options.delayAfter) {
    const delay = (entry.count - options.delayAfter) * options.timeWait;
    useLogger().set({ rateLimit: { delayed: true, delayMs: delay, key } });
    await sleep(delay);
  }
}
