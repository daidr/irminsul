import { keccak_512 } from "js-sha3";
import { timingSafeEqual } from "node:crypto";
import type { HashVersion } from "~~/server/types/user.schema";

const LEGACY_PASSWORD_SUFFIX = "dKfkZh";

/**
 * 验证密码，根据 hashVersion 分派到不同的验证逻辑
 */
export async function verifyPassword(
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
      useLogger().set({ auth: { warning: "unknown_hash_version", hashVersion } });
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
  if (computed.length !== storedHash.length) return false;
  return timingSafeEqual(Buffer.from(computed), Buffer.from(storedHash));
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
