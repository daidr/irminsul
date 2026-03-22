import fs from "node:fs/promises";
import path from "node:path";

export default defineEventHandler(async (event) => {
  const hash = getRouterParam(event, "hash");

  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid hash" });
  }

  const filePath = path.join("./irminsul-data/textures", hash);

  try {
    const buffer = await fs.readFile(filePath);
    setHeader(event, "Content-Type", "image/png");
    setHeader(event, "Cache-Control", "public, max-age=31536000, immutable");
    return buffer;
  } catch {
    throw createError({ statusCode: 404, statusMessage: "Texture not found" });
  }
});
