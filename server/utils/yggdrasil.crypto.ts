import fs from "node:fs/promises";
import crypto from "node:crypto";

const RSA_PRIVATE_KEY_PATH = "./irminsul-data/auto-generate/yggdrasil-private.pem";
const RSA_PUBLIC_KEY_PATH = "./irminsul-data/auto-generate/yggdrasil-public.pem";

let privateKey: string | null = null;
let publicKeyPem: string | null = null;

async function fileExists(path: string): Promise<boolean> {
  return fs
    .access(path)
    .then(() => true)
    .catch(() => false);
}

/**
 * 加载 RSA 密钥对
 * - 两者都存在：直接加载
 * - 两者都不存在：自动生成
 * - 仅一者存在：报错退出
 */
export async function loadOrGenerateKeys(): Promise<void> {
  const log = createLogger({ category: "crypto" });
  const privateExists = await fileExists(RSA_PRIVATE_KEY_PATH);
  const publicExists = await fileExists(RSA_PUBLIC_KEY_PATH);

  if (privateExists !== publicExists) {
    const missing = privateExists ? RSA_PUBLIC_KEY_PATH : RSA_PRIVATE_KEY_PATH;
    throw new Error(
      `RSA key file missing: ${missing}. Both key files must exist, or neither (to auto-generate).`,
    );
  }

  if (!privateExists) {
    log.set({ action: "generateRsaKeys" });
    const { privateKey: privPem, publicKey: pubPem } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 4096,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    await fs.writeFile(RSA_PRIVATE_KEY_PATH, privPem, { mode: 0o600 });
    await fs.writeFile(RSA_PUBLIC_KEY_PATH, pubPem, { mode: 0o644 });
    log.set({ status: "generated" });
  } else {
    log.set({ action: "loadRsaKeys", status: "loaded" });
  }

  privateKey = await fs.readFile(RSA_PRIVATE_KEY_PATH, "utf-8");
  publicKeyPem = await fs.readFile(RSA_PUBLIC_KEY_PATH, "utf-8");
  log.emit();
}

/**
 * 获取公钥 PEM 字符串（用于 API 元数据响应）
 */
export function getPublicKeyPem(): string | null {
  return publicKeyPem;
}

/**
 * 使用 RSA SHA1 签名（Yggdrasil 协议要求）
 */
export function signSha1(data: string): string | null {
  if (!privateKey) return null;
  const sign = crypto.createSign("SHA1");
  sign.update(data);
  return sign.sign(privateKey, "base64");
}

export const CERT_EXPIRY_MS = 48 * 60 * 60 * 1000; // 48h
const CERT_REFRESH_MS = 36 * 60 * 60 * 1000; // 36h

/**
 * 将标准 UUID 字符串转换为 16 字节 Buffer
 */
export function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

/**
 * 将 SPKI/PKCS8 格式的 PEM 头部替换为带 RSA 前缀的头部
 *
 * Minecraft 客户端期望 PEM 头部为 "BEGIN RSA PUBLIC/PRIVATE KEY"，
 * 但内部使用 X509EncodedKeySpec(SPKI) / PKCS8EncodedKeySpec 解析，
 * 因此二进制内容必须是 SPKI/PKCS8 格式，仅替换头尾标记。
 */
function repackPem(pem: string, keyType: "PUBLIC" | "PRIVATE"): string {
  const lines = pem.split("\n");
  lines[0] = `-----BEGIN RSA ${keyType} KEY-----`;
  lines[lines.length - 2] = `-----END RSA ${keyType} KEY-----`;
  return lines.join("\n");
}

/**
 * 为玩家生成证书密钥对（用于 1.19+ 聊天签名）
 */
export function generatePlayerCertificates(playerUuid: string) {
  if (!privateKey) {
    throw new Error("Server RSA keys not loaded");
  }

  const now = Date.now();
  const expiresAt = now + CERT_EXPIRY_MS;
  const refreshedAfter = now + CERT_REFRESH_MS;

  // 生成 2048 位玩家密钥对（SPKI/PKCS8 编码，头部替换为 RSA 前缀）
  const playerKeyPair = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const publicKeyPemRepacked = repackPem(playerKeyPair.publicKey, "PUBLIC");
  const privateKeyPemRepacked = repackPem(playerKeyPair.privateKey, "PRIVATE");

  // 获取公钥的 SPKI DER 格式（用于签名）
  const pubKeyObj = crypto.createPublicKey(playerKeyPair.publicKey);
  const publicKeySpkiDer = pubKeyObj.export({ type: "spki", format: "der" });

  // expiresAt 大端 8 字节
  const expiresAtBuf = Buffer.alloc(8);
  expiresAtBuf.writeBigUInt64BE(BigInt(expiresAt));

  // v1 签名: SHA1withRSA(expiresAt_string + publicKeyPEM)
  const v1Data = expiresAt + publicKeyPemRepacked;
  const signV1 = crypto.createSign("SHA1");
  signV1.update(v1Data);
  const publicKeySignature = signV1.sign(privateKey, "base64");

  // v2 签名: SHA1withRSA(uuid_16bytes + expiresAt_ms_BE8 + publicKey_SPKI_DER)
  const uuidBytes = uuidToBytes(playerUuid);
  const v2Data = Buffer.concat([uuidBytes, expiresAtBuf, publicKeySpkiDer]);
  const signV2 = crypto.createSign("SHA1");
  signV2.update(v2Data);
  const publicKeySignatureV2 = signV2.sign(privateKey, "base64");

  return {
    keyPair: {
      privateKey: privateKeyPemRepacked,
      publicKey: publicKeyPemRepacked,
    },
    publicKeySignature,
    publicKeySignatureV2,
    expiresAt: new Date(expiresAt).toISOString(),
    refreshedAfter: new Date(refreshedAfter).toISOString(),
  };
}
