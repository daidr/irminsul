import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { setCreateCanvas, renderAvatar } from "@daidr/minecraft-skin-renderer/canvas2d";

// One-time setup: provide canvas factory to the renderer
setCreateCanvas((w, h) => createCanvas(w, h) as any);

// UUID with hyphens: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
const UUID_HYPHEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// UUID without hyphens: 32 hex chars
const UUID_NOHYPHEN_RE = /^[0-9a-f]{32}$/i;

function addHyphens(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * 渲染后的头像 PNG 缓存。输出完全由 (skinHash, slim, scale) 决定，且 skinHash 内容寻址
 * （皮肤变更即换 hash），因此可安全缓存。避免每次请求都读盘 + 解码 + Canvas 渲染 + PNG
 * 重编码（CPU 密集）。头像是高频外链资源（启动器/论坛签名）。
 */
const AVATAR_CACHE_LIMIT = 1000;
const avatarCache = new Map<string, Buffer>();

export default defineEventHandler(async (event) => {
  const identifier = getRouterParam(event, "identifier");
  if (!identifier) {
    throw createError({ statusCode: 400, statusMessage: "Missing identifier" });
  }

  // Parse scale from query (1-4, default 3)
  const query = getQuery(event);
  const rawScale = Number(query.scale) || 3;
  const scale = Math.min(4, Math.max(1, Math.floor(rawScale)));

  // Resolve user by identifier type
  let user;
  if (UUID_HYPHEN_RE.test(identifier)) {
    user = await findUserByUuid(identifier);
  } else if (UUID_NOHYPHEN_RE.test(identifier)) {
    user = await findUserByUuid(addHyphens(identifier));
  } else {
    user = await findUserByGameId(identifier);
  }

  const skinHash = user?.skin?.hash || useRuntimeConfig(event).yggdrasilDefaultSkinHash;

  if (!skinHash) {
    throw createError({ statusCode: 404, statusMessage: "No skin available" });
  }

  const slim = user?.skin?.type === 1;

  // 渲染结果由 (skinHash, slim, scale) 唯一决定，据此命中缓存并支持条件请求
  const cacheKey = `${skinHash}|${slim ? 1 : 0}|${scale}`;
  const etag = `"${cacheKey}"`;
  setHeader(event, "Content-Type", "image/png");
  setHeader(event, "Cache-Control", "public, max-age=3600");
  setHeader(event, "ETag", etag);

  if (getHeader(event, "if-none-match") === etag) {
    setResponseStatus(event, 304);
    return null;
  }

  let pngBuffer = avatarCache.get(cacheKey);
  if (!pngBuffer) {
    // Load skin texture from disk
    const filePath = path.join("./irminsul-data/textures", skinHash) + ".png";
    let skinImage;
    try {
      const buffer = await fs.readFile(filePath);
      skinImage = await loadImage(buffer);
    } catch {
      throw createError({ statusCode: 404, statusMessage: "Skin texture not found" });
    }

    // Render avatar
    // Avatar is 8x8 MC pixels. With overlayInflated, output = 9 * mcScale.
    // scale 1-4 maps to mcScale 2-8, output 18/36/54/72px.
    // renderAvatar sets canvas.width/height internally.
    const mcScale = scale * 2;
    const canvas = createCanvas(1, 1);

    await renderAvatar(canvas as any, {
      skin: skinImage as any,
      scale: mcScale,
      slim,
      showOverlay: true,
      overlayInflated: true,
    });

    pngBuffer = canvas.toBuffer("image/png");

    // 超出上限时淘汰最早插入的项（Map 保持插入顺序）
    if (avatarCache.size >= AVATAR_CACHE_LIMIT) {
      const oldest = avatarCache.keys().next().value;
      if (oldest !== undefined) avatarCache.delete(oldest);
    }
    avatarCache.set(cacheKey, pngBuffer);
  }

  return pngBuffer;
});
