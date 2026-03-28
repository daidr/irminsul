export default defineEventHandler(async (event) => {
  const providerId = getRouterParam(event, "providerId");
  if (!providerId) {
    throw createError({ statusCode: 400, statusMessage: "Missing providerId" });
  }

  const manager = getPluginManager();
  const provider = manager.getOAuthProvider(providerId);
  if (!provider) {
    throw createError({ statusCode: 404, statusMessage: "OAuth provider not found" });
  }

  const query = getQuery(event);
  const action = query.action as string;
  if (action !== "bind" && action !== "login") {
    throw createError({ statusCode: 400, statusMessage: "Invalid action, must be 'bind' or 'login'" });
  }

  let userId: string | undefined;

  if (action === "bind") {
    const user = requireAuth(event);
    userId = user.userId;

    const existingBinding = user.oauthBindings?.find(
      (b: { provider: string }) => b.provider === providerId,
    );
    if (existingBinding) {
      return sendRedirect(event, "/home?oauth=duplicate");
    }
  }

  const state = await createOAuthState({
    action,
    userId,
    providerId,
  });

  const redirectUri = buildCallbackUrl(providerId);

  const result = (await manager.callPluginHook(
    provider.pluginId,
    "oauth:authorize",
    { redirectUri, state },
  )) as { url?: string } | null;

  const authorizeUrl = result?.url;
  if (!authorizeUrl || typeof authorizeUrl !== "string" || !authorizeUrl.startsWith("https://")) {
    throw createError({ statusCode: 500, statusMessage: "OAuth plugin returned invalid authorize URL" });
  }

  return sendRedirect(event, authorizeUrl);
});
