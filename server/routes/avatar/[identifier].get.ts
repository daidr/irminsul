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
  // Avatar is 8x8 MC pixels, scale * 2 maps user scale 1-4 to output 16/32/48/64px
  const mcScale = scale * 2;
  const size = 8 * mcScale;
  const canvas = createCanvas(size, size);

  await renderAvatar(canvas as any, {
    skin: skinImage as any,
    scale: mcScale,
    slim,
    showOverlay: true,
    overlayInflated: true,
  });

  // Return PNG
  const pngBuffer = canvas.toBuffer("image/png");
  setHeader(event, "Content-Type", "image/png");
  setHeader(event, "Cache-Control", "public, max-age=3600");
  return pngBuffer;
});
