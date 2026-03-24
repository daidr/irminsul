import crypto from "node:crypto";
import { useLogger } from "evlog";

const VERIFY_PREFIX = "email-verify";
const VERIFY_LOCK_PREFIX = "email-verify-lock";
const VERIFY_EXPIRY_SECONDS = 10 * 60; // 10 minutes

interface VerifyTokenData {
  userId: string;
  email: string;
  createdAt: number;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function verifyKey(tokenHash: string): string {
  return buildRedisKey(VERIFY_PREFIX, tokenHash);
}

function lockKey(userId: string): string {
  return buildRedisKey(VERIFY_LOCK_PREFIX, userId);
}

export async function hasActiveEmailVerificationToken(userId: string): Promise<boolean> {
  const redis = getRedisClient();
  const raw = (await redis.send("GET", [lockKey(userId)])) as string | null;
  return raw !== null;
}

export async function createEmailVerificationToken(
  userId: string,
  email: string,
): Promise<string | null> {
  if (await hasActiveEmailVerificationToken(userId)) {
    useLogger().set({ emailVerification: { skipped: "token_already_active", userId } });
    return null;
  }

  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const rawToken = Buffer.from(tokenBytes).toString("hex");
  const tokenHash = hashToken(rawToken);
  const key = verifyKey(tokenHash);

  const data: VerifyTokenData = {
    userId,
    email,
    createdAt: Date.now(),
  };

  const redis = getRedisClient();
  await redis.send("SET", [key, JSON.stringify(data), "EX", VERIFY_EXPIRY_SECONDS.toString()]);
  await redis.send("SET", [lockKey(userId), tokenHash, "EX", VERIFY_EXPIRY_SECONDS.toString()]);

  useLogger().set({ emailVerification: { tokenCreated: true, userId } });
  return rawToken;
}

export async function verifyEmailVerificationToken(
  token: string,
): Promise<{ userId: string; email: string } | null> {
  const tokenHash = hashToken(token);
  const key = verifyKey(tokenHash);
  const redis = getRedisClient();
  const raw = (await redis.send("GET", [key])) as string | null;
  if (!raw) return null;

  const data = JSON.parse(raw) as VerifyTokenData;
  return { userId: data.userId, email: data.email };
}

export async function consumeEmailVerificationToken(
  token: string,
): Promise<{ userId: string; email: string } | null> {
  const tokenHash = hashToken(token);
  const key = verifyKey(tokenHash);
  const redis = getRedisClient();
  const raw = (await redis.send("GET", [key])) as string | null;
  if (!raw) return null;

  const data = JSON.parse(raw) as VerifyTokenData;

  await redis.send("DEL", [key]);
  await redis.send("DEL", [lockKey(data.userId)]);

  useLogger().set({ emailVerification: { tokenConsumed: true, userId: data.userId } });
  return { userId: data.userId, email: data.email };
}
