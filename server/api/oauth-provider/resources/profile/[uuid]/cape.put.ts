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
