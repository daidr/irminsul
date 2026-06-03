export default defineOAuthResourceHandler(["profile:write"], async (event, { tokenInfo }) => {
  const uuid = requireProfileOwnership(event, tokenInfo);

  // Read multipart form data
  const formData = await readMultipartFormData(event);
  if (!formData) {
    throw createError({ statusCode: 400, statusMessage: "Multipart form data required" });
  }

  let fileBuffer: Buffer | undefined;

  for (const part of formData) {
    if (part.name === "file" && part.data) {
      fileBuffer = part.data;
    }
  }

  if (!fileBuffer) {
    throw createError({ statusCode: 400, statusMessage: "Missing texture file" });
  }

  // Limit upload size: 1MB
  const MAX_TEXTURE_SIZE = 1024 * 1024;
  if (fileBuffer.length > MAX_TEXTURE_SIZE) {
    throw createError({ statusCode: 400, statusMessage: "Texture file too large (max 1MB)" });
  }

  try {
    const result = await processTextureUpload(event, {
      uuid,
      textureType: "cape",
      fileBuffer,
    });
    return { hash: result.hash };
  } catch (err) {
    throw createError({
      statusCode: 400,
      statusMessage: err instanceof Error ? err.message : "Texture upload failed",
    });
  }
});
