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
    tokenInfo = await requireOAuthBearer(event, ["profile:read"]);
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

  // Fetch user
  const user = await findUserByUuid(uuid);
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  return {
    uuid: user.uuid,
    gameId: user.gameId,
    skin: user.skin,
    cape: user.cape,
  };
});
