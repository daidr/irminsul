const SESSION_USER_CACHE_PREFIX = "usercache";
const SESSION_USER_CACHE_TTL = 30; // seconds

/**
 * Get cached user session data from Redis.
 * Returns null on cache miss.
 */
export async function getCachedSessionUser(
  userId: string,
): Promise<ReturnType<typeof findUserForSession>> {
  const redis = getRedisClient();
  const key = buildRedisKey(SESSION_USER_CACHE_PREFIX, userId);
  const raw = (await redis.send("GET", [key])) as string | null;
  if (!raw) return null;
  return JSON.parse(raw);
}

/**
 * Cache user session data in Redis with TTL.
 */
export async function setCachedSessionUser(
  userId: string,
  data: NonNullable<Awaited<ReturnType<typeof findUserForSession>>>,
): Promise<void> {
  const redis = getRedisClient();
  const key = buildRedisKey(SESSION_USER_CACHE_PREFIX, userId);
  await redis.send("SET", [key, JSON.stringify(data), "EX", SESSION_USER_CACHE_TTL.toString()]);
}

/**
 * Invalidate cached user session data.
 * Call this whenever user profile fields change (skin, cape, password, email verification,
 * admin/developer status, OAuth bindings, etc.).
 */
export async function invalidateSessionUserCache(userId: string): Promise<void> {
  const redis = getRedisClient();
  const key = buildRedisKey(SESSION_USER_CACHE_PREFIX, userId);
  await redis.send("DEL", [key]);
}
