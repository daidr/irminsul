export default defineOAuthResourceHandler(["profile:write"], async (event, { tokenInfo }) => {
  const uuid = requireProfileOwnership(event, tokenInfo);

  try {
    await processTextureDelete(event, { uuid, textureType: "cape" });
    setResponseStatus(event, 204);
    return null;
  } catch (err) {
    throw createError({
      statusCode: 400,
      statusMessage: err instanceof Error ? err.message : "Texture delete failed",
    });
  }
});
