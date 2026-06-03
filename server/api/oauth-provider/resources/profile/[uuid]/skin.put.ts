export default defineOAuthResourceHandler(["profile:write"], async (event, { tokenInfo }) => {
  const uuid = requireProfileOwnership(event, tokenInfo);

  // Read multipart form data
  const formData = await readMultipartFormData(event);
  if (!formData) {
    throw createError({ statusCode: 400, statusMessage: "Multipart form data required" });
  }

  let model: number | undefined;
  let fileBuffer: Buffer | undefined;

  for (const part of formData) {
    if (part.name === "model" && part.data) {
      const modelStr = part.data.toString("utf-8");
      model = modelStr === "slim" || modelStr === "1" ? 1 : 0;
    } else if (part.name === "file" && part.data) {
      fileBuffer = part.data;
    }
  }

  if (!fileBuffer) {
    throw createError({ statusCode: 400, statusMessage: "Missing texture file" });
  }

  // Limit upload size: 1MB
  if (fileBuffer.length > MAX_TEXTURE_UPLOAD_SIZE) {
    throw createError({ statusCode: 400, statusMessage: "Texture file too large (max 1MB)" });
  }

  try {
    const result = await processTextureUpload(event, {
      uuid,
      textureType: "skin",
      model,
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
