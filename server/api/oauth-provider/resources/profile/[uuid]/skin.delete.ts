export default defineEventHandler(async (event) => {
  // Check if OAuth is enabled
  const oauthEnabled = getSetting("oauth.enabled");
  if (!oauthEnabled) {
    throw createError({ statusCode: 404, statusMessage: "OAuth is not enabled" });
  }

  // CORS
  setResponseHeader(event, "Access-Control-Allow-Origin", "*");

  // Validate bearer token
  let tokenInfo;
  try {
    tokenInfo = await requireOAuthBearer(event, ["profile:write"]);
  } catch (err) {
    if (err instanceof OAuthError) {
      setResponseStatus(event, err.statusCode);
      return { error: err.errorCode, error_description: err.errorDescription };
    }
    throw err;
  }

  // Get uuid from route param
  const uuid = getRouterParam(event, "uuid");
  if (!uuid) {
    throw createError({ statusCode: 400, statusMessage: "Missing uuid parameter" });
  }

  // Can only modify own textures
  if (tokenInfo.userId !== uuid) {
    setResponseStatus(event, 403);
    return { error: "access_denied", error_description: "Cannot modify another user's textures" };
  }

  try {
    await processTextureDelete(event, { uuid, textureType: "skin" });
    setResponseStatus(event, 204);
    return null;
  } catch (err) {
    throw createError({
      statusCode: 400,
      statusMessage: err instanceof Error ? err.message : "Texture delete failed",
    });
  }
});
