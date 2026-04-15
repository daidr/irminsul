import { keccak_512 } from "js-sha3";
import { timingSafeEqual } from "node:crypto";
import type { H3Event } from "h3";
import { useLogger } from "evlog";
import type { HashVersion } from "~~/server/types/user.schema";

const LEGACY_PASSWORD_SUFFIX = "dKfkZh";

/**
 * Burn an argon2id verify on a fixed dummy hash so "user not found" and
 * "user found / password wrong" branches take the same wall time.
 * Always returns false.
 *
 * The hash is a pre-computed argon2id of a random string generated at build
 * time. Any argon2id hash at identical params burns the same time, so
 * the exact plaintext does not matter.
 */
const DUMMY_ARGON2_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$Tc8QLOk0kKZ1Yk7yI7SDqw$qmS1i0hX0w39dNwtv3j58Tm6KOGf4lHq7Pw+Vk7YqYA";

export async function dummyPasswordVerify(plaintext: string): Promise<false> {
  try {
    await Bun.password.verify(plaintext, DUMMY_ARGON2_HASH);
  } catch (err) {
    // Should never happen in production. Log loudly if it ever does —
    // silent failure here would silently degrade the timing-side-channel
    // defense.
    console.warn("[security] dummyPasswordVerify threw:", (err as Error).message);
  }
  return false;
}

/**
 * 验证密码，根据 hashVersion 分派到不同的验证逻辑
 */
export async function verifyPassword(
  event: H3Event,
  plaintext: string,
  storedHash: string,
  hashVersion: HashVersion,
): Promise<boolean> {
  switch (hashVersion) {
    case "argon2id":
      return Bun.password.verify(plaintext, storedHash);

    case "legacy":
      return verifyLegacy(plaintext, storedHash);

    default:
      useLogger(event).set({ auth: { warning: "unknown_hash_version", hashVersion } });
      return false;
  }
}

/**
 * Legacy 密码验证:
 *   1. password += "dKfkZh"
 *   2. Keccak-512(password).hex()
 *   3. HmacSHA256(result, globalSalt).hex()
 *   4. 与存储的 hash 比较
 */
async function verifyLegacy(plaintext: string, storedHash: string): Promise<boolean> {
  const legacyGlobalSalt = (useRuntimeConfig().legacyGlobalSalt as string) || "";
  const preprocessed = legacyPreprocess(plaintext);
  const computed = await hmacSha256(preprocessed, legacyGlobalSalt);
  let ok = false;
  if (computed.length === storedHash.length) {
    ok = timingSafeEqual(Buffer.from(computed), Buffer.from(storedHash));
  }
  if (!ok) {
    // Pad to argon2id timing so legacy / argon2id / not-found all cost the same
    // on the failure path — prevents legacy-user fingerprinting by timing.
    await dummyPasswordVerify(plaintext);
  }
  return ok;
}

/**
 * Legacy 密码预处理: Keccak-512(plaintext + 'dKfkZh').hex()
 * CryptoJS.SHA3 实际使用 Keccak（非 NIST SHA-3），此处保持一致
 */
function legacyPreprocess(plaintext: string): string {
  return keccak_512(plaintext + LEGACY_PASSWORD_SUFFIX);
}

/**
 * HMAC-SHA256，返回小写 hex 字符串
 * 复制 CryptoJS.HmacSHA256(message, key).toString() 的行为
 */
async function hmacSha256(message: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return Buffer.from(signature).toString("hex");
}

/**
 * 使用 Argon2id 哈希新密码（用于新注册和密码迁移）
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return Bun.password.hash(plaintext, {
    algorithm: "argon2id",
    memoryCost: 19456,
    timeCost: 2,
  });
}
