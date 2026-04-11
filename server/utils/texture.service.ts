import fs from "node:fs/promises";
import path from "node:path";
import type { H3Event } from "h3";
import { useLogger } from "evlog";
//@ts-expect-error pngjs-nozlib 没有类型定义
import { PNG } from "pngjs-nozlib";

const TEXTURES_DIR = "./irminsul-data/textures";

/**
 * 计算材质哈希（与 GHAuth computeTextureHash 一致）
 * 对解码后的像素数据做 SHA-256，确保不同压缩参数的同一图片哈希一致
 */
export function computeTextureHash(image: { width: number; height: number; data: Buffer }): string {
  const bufSize = 8192;
  const hasher = new Bun.CryptoHasher("sha256");
  const buf = Buffer.allocUnsafe(bufSize);
  const { width, height } = image;
  buf.writeUInt32BE(width, 0);
  buf.writeUInt32BE(height, 4);
  let pos = 8;
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const imgidx = (width * y + x) << 2;
      const alpha = image.data[imgidx + 3];
      buf.writeUInt8(alpha, pos + 0);
      if (alpha === 0) {
        buf.writeUInt8(0, pos + 1);
        buf.writeUInt8(0, pos + 2);
        buf.writeUInt8(0, pos + 3);
      } else {
        buf.writeUInt8(image.data[imgidx + 0], pos + 1);
        buf.writeUInt8(image.data[imgidx + 1], pos + 2);
        buf.writeUInt8(image.data[imgidx + 2], pos + 3);
      }
      pos += 4;
      if (pos === bufSize) {
        pos = 0;
        hasher.update(buf);
      }
    }
  }
  if (pos > 0) {
    hasher.update(buf.subarray(0, pos));
  }
  return hasher.digest("hex");
}

/**
 * 检查指定哈希是否仍有用户使用，若无人使用则删除对应材质文件
 */
export async function tryRemoveUnusedTexture(event: H3Event, hash: string): Promise<void> {
  const inUse = await isTextureHashInUse(hash);
  if (!inUse) {
    const filePath = path.join(TEXTURES_DIR, `${hash}.png`);
    await fs.unlink(filePath).catch(() => {});
    useLogger(event).set({ texture: { unusedRemoved: true, hash } });
  }
}

/**
 * 处理材质上传（解析 PNG → 校验尺寸 → 算哈希 → 存文件 → 更新 DB → 清理旧文件）
 */
export async function processTextureUpload(event: H3Event, params: {
  uuid: string;
  textureType: "skin" | "cape";
  model?: number; // 0 = Steve, 1 = Alex
  fileBuffer: Buffer;
}): Promise<{ hash: string }> {
  const { uuid, textureType, model, fileBuffer } = params;

  // 读取并解析 PNG
  let png: PNG;
  try {
    png = PNG.sync.read(fileBuffer);
  } catch {
    throw new Error("Invalid PNG file.");
  }

  // 尺寸校验
  if (textureType === "skin") {
    if (png.width !== 64 || (png.height !== 64 && png.height !== 32)) {
      throw new Error("Invalid skin dimensions. Expected 64x64 or 64x32.");
    }
  } else {
    if (png.width !== 64 || png.height !== 32) {
      throw new Error("Invalid cape dimensions. Expected 64x32.");
    }
  }

  // 基于像素数据计算 SHA-256 哈希
  const hash = computeTextureHash(png);

  // 获取当前用户数据（记录旧哈希）
  const user = await findUserByUuid(uuid);
  if (!user) throw new Error("User not found.");
  const oldHash = textureType === "skin" ? user.skin?.hash : user.cape?.hash;

  // 重新编码并存储（去除多余元数据）
  const cleanPng = PNG.sync.write(png);
  const filePath = path.join(TEXTURES_DIR, `${hash}.png`);
  await fs.writeFile(filePath, cleanPng);

  // 更新用户文档
  if (textureType === "skin") {
    const skinType = (model === 1 ? 1 : 0) as 0 | 1;
    await updateUserSkin(uuid, { type: skinType, hash });
  } else {
    await updateUserCape(uuid, { hash });
  }

  await invalidateSessionUserCache(uuid);

  // 清理旧材质文件（若无人使用）
  if (oldHash && oldHash !== hash) {
    await tryRemoveUnusedTexture(event, oldHash);
  }

  useLogger(event).set({ texture: { action: "upload", type: textureType, userId: uuid, hash } });
  return { hash };
}

/**
 * 处理材质删除（置 null → 清理旧文件）
 */
export async function processTextureDelete(event: H3Event, params: {
  uuid: string;
  textureType: "skin" | "cape";
}): Promise<void> {
  const { uuid, textureType } = params;

  // 获取当前用户数据（记录旧哈希）
  const user = await findUserByUuid(uuid);
  if (!user) throw new Error("User not found.");
  const oldHash = textureType === "skin" ? user.skin?.hash : user.cape?.hash;

  if (textureType === "skin") {
    await updateUserSkin(uuid, null);
  } else {
    await updateUserCape(uuid, null);
  }

  await invalidateSessionUserCache(uuid);

  // 清理旧材质文件（若无人使用）
  if (oldHash) {
    await tryRemoveUnusedTexture(event, oldHash);
  }

  useLogger(event).set({ texture: { action: "delete", type: textureType, userId: uuid } });
}
