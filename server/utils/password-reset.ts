import crypto from "node:crypto";
import type { H3Event } from "h3";
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
  event: H3Event,
  userId: string,
  email: string,
): Promise<string | null> {
  const redis = getRedisClient();

  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const rawToken = Buffer.from(tokenBytes).toString("hex");
  const tokenHash = hashToken(rawToken);
  const key = resetKey(tokenHash);

  // Atomically acquire lock — if lock already exists, another token is active
  const lockResult = await redis.send("SET", [
    lockKey(userId),
    tokenHash,
    "EX",
    RESET_EXPIRY_SECONDS.toString(),
    "NX",
  ]);
  if (!lockResult) {
    useLogger(event).set({ passwordReset: { skipped: "token_already_active", userId } });
    return null;
  }

  const data: ResetTokenData = {
    userId,
    email,
    createdAt: Date.now(),
  };

  await redis.send("SET", [key, JSON.stringify(data), "EX", RESET_EXPIRY_SECONDS.toString()]);

  useLogger(event).set({ passwordReset: { tokenCreated: true, userId } });
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
  event: H3Event,
  token: string,
): Promise<{ userId: string; email: string } | null> {
  const tokenHash = hashToken(token);
  const key = resetKey(tokenHash);
  const redis = getRedisClient();
  const raw = (await redis.send("GETDEL", [key])) as string | null;
  if (!raw) return null;

  const data = JSON.parse(raw) as ResetTokenData;

  await redis.send("DEL", [lockKey(data.userId)]);

  useLogger(event).set({ passwordReset: { tokenConsumed: true, userId: data.userId } });
  return { userId: data.userId, email: data.email };
}
