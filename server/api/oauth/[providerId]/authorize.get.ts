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

  // 提前校验 clientId 和 clientSecret 是否配置，避免用户完成授权后才失败
  const pluginConfig = getSetting(`plugin.custom.${provider.pluginId}.config`) as Record<string, unknown> | null;
  const clientId = pluginConfig?.clientId as string;
  const clientSecret = pluginConfig?.clientSecret as string;
  if (!clientId || !clientSecret) {
    throw createError({ statusCode: 500, statusMessage: "OAuth provider credentials not configured" });
  }

  let userId: string | undefined;

  if (action === "bind") {
    const user = requireAuth(event);
    userId = user.userId;

    // 检查是否已绑定该 provider
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
  const { descriptor } = provider;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: descriptor.authorize.scopes.join(" "),
    state,
    response_type: "code",
  });

  const authorizeUrl = `${descriptor.authorize.url}?${params.toString()}`;
  return sendRedirect(event, authorizeUrl);
});
