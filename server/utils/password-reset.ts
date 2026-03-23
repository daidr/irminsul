import crypto from "node:crypto";
import { useLogger } from "evlog";

const RESET_PREFIX = "password-reset";
const RESET_LOCK_PREFIX = "password-reset-lock";
const RESET_EXPIRY_SECONDS = 10 * 60; // 10 minutes

interface ResetTokenData {
  userId: string;
  email: string;
  createdAt: number;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function resetKey(tokenHash: string): string {
  return buildRedisKey(RESET_PREFIX, tokenHash);
}

function lockKey(userId: string): string {
  return buildRedisKey(RESET_LOCK_PREFIX, userId);
}

/**
 * 检查用户是否已有未过期的密码重置 token
 */
export async function hasActivePasswordResetToken(userId: string): Promise<boolean> {
  const redis = getRedisClient();
  const raw = (await redis.send("GET", [lockKey(userId)])) as string | null;
  return raw !== null;
}

/**
 * 创建密码重置 token。如果用户已有未过期的 token，返回 null。
 */
export async function createPasswordResetToken(
  userId: string,
  email: string,
): Promise<string | null> {
  if (await hasActivePasswordResetToken(userId)) {
    useLogger().set({ passwordReset: { skipped: "token_already_active", userId } });
    return null;
  }

  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const rawToken = Buffer.from(tokenBytes).toString("hex");
  const tokenHash = hashToken(rawToken);
  const key = resetKey(tokenHash);

  const data: ResetTokenData = {
    userId,
    email,
    createdAt: Date.now(),
  };

  const redis = getRedisClient();
  await redis.send("SET", [key, JSON.stringify(data), "EX", RESET_EXPIRY_SECONDS.toString()]);
  await redis.send("SET", [lockKey(userId), tokenHash, "EX", RESET_EXPIRY_SECONDS.toString()]);

  useLogger().set({ passwordReset: { tokenCreated: true, userId } });
  return rawToken;
}

export async function verifyPasswordResetToken(
  token: string,
): Promise<{ userId: string; email: string } | null> {
  const tokenHash = hashToken(token);
  const key = resetKey(tokenHash);
  const redis = getRedisClient();
  const raw = (await redis.send("GET", [key])) as string | null;
  if (!raw) return null;

  const data = JSON.parse(raw) as ResetTokenData;
  return { userId: data.userId, email: data.email };
}

export async function consumePasswordResetToken(
  token: string,
): Promise<{ userId: string; email: string } | null> {
  const tokenHash = hashToken(token);
  const key = resetKey(tokenHash);
  const redis = getRedisClient();
  const raw = (await redis.send("GET", [key])) as string | null;
  if (!raw) return null;

  const data = JSON.parse(raw) as ResetTokenData;

  await redis.send("DEL", [key]);
  await redis.send("DEL", [lockKey(data.userId)]);

  useLogger().set({ passwordReset: { tokenConsumed: true, userId: data.userId } });
  return { userId: data.userId, email: data.email };
}
