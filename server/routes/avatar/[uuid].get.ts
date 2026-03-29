import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { setCreateCanvas, renderAvatar } from "@daidr/minecraft-skin-renderer/canvas2d";

// One-time setup: provide canvas factory to the renderer
setCreateCanvas((w, h) => createCanvas(w, h) as any);

export default defineEventHandler(async (event) => {
  const uuid = getRouterParam(event, "uuid");
  if (!uuid) {
    throw createError({ statusCode: 400, statusMessage: "Missing uuid" });
  }

  // Parse scale from query (1-4, default 3)
  const query = getQuery(event);
  const rawScale = Number(query.scale) || 3;
  const scale = Math.min(4, Math.max(1, Math.floor(rawScale)));

  // Look up user to get skin hash
  const user = await findUserByUuid(uuid);
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
  // renderAvatar expects scale in MC pixels, avatar is 8x8 MC pixels
  // Output size = 8 * scale per MC pixel. We use scale * 2 to map user scale 1-4 to reasonable sizes.
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
