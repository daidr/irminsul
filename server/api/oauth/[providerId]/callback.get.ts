import { useLogger } from "evlog";

export default defineEventHandler(async (event) => {
  const log = useLogger(event);
  const providerId = getRouterParam(event, "providerId");
  const query = getQuery(event);
  const code = query.code as string;
  const stateParam = query.state as string;
  const errorParam = query.error as string;

  // 处理第三方返回的错误（如用户拒绝授权）
  if (errorParam) {
    if (stateParam) await consumeOAuthState(stateParam); // 清理 Redis state
    if (errorParam === "access_denied") {
      return sendRedirect(event, "/login?oauth=denied");
    }
    return sendRedirect(event, "/login?oauth=error");
  }

  if (!providerId || !code || !stateParam) {
    return sendRedirect(event, "/login?oauth=error");
  }

  // 1. 消费 state
  const stateData = await consumeOAuthState(stateParam);
  if (!stateData) {
    return sendRedirect(event, "/login?oauth=error");
  }

  if (stateData.providerId !== providerId) {
    return sendRedirect(event, "/login?oauth=error");
  }

  const manager = getPluginManager();
  const provider = manager.getOAuthProvider(providerId);
  if (!provider) {
    return sendRedirect(event, "/login?oauth=error");
  }

  const { descriptor, pluginId } = provider;

  try {
    // 2. 读取插件凭据
    const pluginConfig = getSetting(`plugin.custom.${pluginId}.config`) as Record<string, unknown> | null;
    const clientId = pluginConfig?.clientId as string;
    const clientSecret = pluginConfig?.clientSecret as string;
    if (!clientId || !clientSecret) {
      log.set({ oauth: { error: "missing_credentials", providerId } });
      return sendRedirect(event, "/login?oauth=error");
    }

    const redirectUri = buildCallbackUrl(providerId);

    // 3. Token 交换（尝试插件覆盖，回退到默认）
    const hookRegistry = manager.getHookRegistry();
    let tokenResult: { accessToken: string; tokenType?: string };

    const hasExchangeHook = hookRegistry.get("oauth:exchange-token")
      .some((h) => h.pluginId === pluginId);

    if (hasExchangeHook) {
      tokenResult = (await manager.callPluginHook(pluginId, "oauth:exchange-token", {
        code,
        redirectUri,
        clientId,
        clientSecret,
      })) as { accessToken: string; tokenType?: string };
    } else {
      tokenResult = await defaultExchangeToken(descriptor.token.url, {
        code,
        redirectUri,
        clientId,
        clientSecret,
      });
    }

    // 4. 获取用户信息（尝试插件覆盖，回退到默认）
    let rawProfile: unknown;

    const hasFetchHook = hookRegistry.get("oauth:fetch-profile")
      .some((h) => h.pluginId === pluginId);

    if (hasFetchHook) {
      rawProfile = await manager.callPluginHook(pluginId, "oauth:fetch-profile", {
        accessToken: tokenResult.accessToken,
        tokenType: tokenResult.tokenType ?? "Bearer",
      });
    } else if (descriptor.userInfo) {
      rawProfile = await defaultFetchProfile(
        descriptor.userInfo.url,
        tokenResult.accessToken,
        tokenResult.tokenType ?? "Bearer",
        descriptor.userInfo.headers,
      );
    } else {
      log.set({ oauth: { error: "no_userinfo_and_no_fetch_hook", providerId } });
      return sendRedirect(event, "/login?oauth=error");
    }

    // 5. 映射 Profile
    const mappedProfile = (await manager.callPluginHook(
      pluginId,
      "oauth:map-profile",
      rawProfile,
    )) as { providerId: string; displayName: string } | null;

    if (!mappedProfile?.providerId || !mappedProfile?.displayName) {
      log.set({ oauth: { error: "invalid_mapped_profile", providerId, rawProfile } });
      return sendRedirect(event, "/login?oauth=error");
    }

    // 6. 根据 action 分流
    if (stateData.action === "bind") {
      // 检查该第三方账号是否已被其他用户绑定
      const existingUser = await findUserByOAuthBinding(providerId, mappedProfile.providerId);
      if (existingUser && existingUser.uuid !== stateData.userId) {
        return sendRedirect(event, "/home?oauth=already-bound");
      }

      // 捕获 MongoDB duplicate key error（并发绑定竞态的最后防线）
      try {
        const added = await addOAuthBinding(stateData.userId!, {
          provider: providerId,
          providerId: mappedProfile.providerId,
          displayName: mappedProfile.displayName,
          boundAt: new Date(),
        });

        if (!added) {
          return sendRedirect(event, "/home?oauth=duplicate");
        }
      } catch (err: any) {
        if (err?.code === 11000) {
          return sendRedirect(event, "/home?oauth=already-bound");
        }
        throw err;
      }

      log.set({ oauth: { action: "bind", providerId, thirdPartyId: mappedProfile.providerId } });
      return sendRedirect(event, "/home?oauth=bind-success");
    }

    // action === "login"
    const user = await findUserByOAuthBinding(providerId, mappedProfile.providerId);
    if (!user) {
      return sendRedirect(event, "/login?oauth=not-bound");
    }

    // 创建 session
    const clientIp = extractClientIp(event);
    const ua = getHeader(event, "user-agent") || "unknown";
    await updateLastLogin(user.uuid, clientIp);

    const sessionData: SessionData = {
      userId: user.uuid,
      email: user.email,
      gameId: user.gameId,
      ip: clientIp,
      ua,
      loginAt: Date.now(),
    };

    await createSession(event, sessionData);
    log.set({ oauth: { action: "login", providerId, userId: user.uuid } });
    return sendRedirect(event, "/home");
  } catch (err: unknown) {
    log.error(err as Error, { step: "oauth_callback", providerId });
    return sendRedirect(event, "/login?oauth=error");
  }
});
