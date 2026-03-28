import type { H3Event } from "h3";
import { useLogger } from "evlog";

interface CallbackParams {
  code: string;
  state: string;
  error?: string;
}

/**
 * OAuth 回调共享逻辑，供 GET（标准 redirect）和 POST（form_post）两种回调方式复用
 */
export async function handleOAuthCallback(event: H3Event, params: CallbackParams) {
  const log = useLogger(event);
  const providerId = getRouterParam(event, "providerId");
  const { code, state: stateParam, error: errorParam } = params;

  // 处理第三方返回的错误（如用户拒绝授权）
  if (errorParam) {
    let errorTarget = "/login";
    if (stateParam) {
      const stateData = await consumeOAuthState(stateParam);
      if (stateData?.action === "bind") errorTarget = "/";
    }
    if (errorParam === "access_denied") {
      return sendRedirect(event, `${errorTarget}?oauth=denied`);
    }
    return sendRedirect(event, `${errorTarget}?oauth=error`);
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

  const errorRedirect = stateData.action === "bind" ? "/?oauth=error" : "/login?oauth=error";

  const manager = getPluginManager();
  const provider = manager.getOAuthProvider(providerId);
  if (!provider) {
    return sendRedirect(event, errorRedirect);
  }

  const { pluginId } = provider;
  const redirectUri = buildCallbackUrl(providerId);

  try {
    // 2. Token 交换
    const tokenResult = (await manager.callPluginHook(pluginId, "oauth:exchange-token", {
      code,
      redirectUri,
    })) as { accessToken?: string; tokenType?: string } | null;

    if (!tokenResult?.accessToken) {
      log.set({ oauth: { error: "empty_access_token", step: "exchange_token", providerId } });
      return sendRedirect(event, errorRedirect);
    }

    const accessToken = tokenResult.accessToken;
    const tokenType = tokenResult.tokenType ?? "Bearer";

    // 3. 获取用户信息
    const rawProfile = await manager.callPluginHook(pluginId, "oauth:fetch-profile", {
      accessToken,
      tokenType,
    });

    // 4. 映射 Profile
    const mappedProfile = (await manager.callPluginHook(
      pluginId,
      "oauth:map-profile",
      rawProfile,
    )) as { providerId: string; displayName: string } | null;

    if (!mappedProfile?.providerId) {
      log.set({ oauth: { error: "invalid_mapped_profile", step: "map_profile", providerId, rawProfile } });
      return sendRedirect(event, errorRedirect);
    }

    // 5. 根据 action 分流
    if (stateData.action === "bind") {
      const existingUser = await findUserByOAuthBinding(providerId, mappedProfile.providerId);
      if (existingUser && existingUser.uuid !== stateData.userId) {
        return sendRedirect(event, "/?oauth=already-bound");
      }

      try {
        const added = await addOAuthBinding(stateData.userId!, {
          provider: providerId,
          providerId: mappedProfile.providerId,
          displayName: mappedProfile.displayName || "",
          boundAt: new Date(),
        });

        if (!added) {
          return sendRedirect(event, "/?oauth=duplicate");
        }
      } catch (err: any) {
        if (err?.code === 11000) {
          return sendRedirect(event, "/?oauth=already-bound");
        }
        throw err;
      }

      log.set({ oauth: { action: "bind", providerId, thirdPartyId: mappedProfile.providerId } });
      return sendRedirect(event, "/?oauth=bind-success");
    }

    // action === "login"
    const user = await findUserByOAuthBinding(providerId, mappedProfile.providerId);
    if (!user) {
      return sendRedirect(event, "/login?oauth=not-bound");
    }

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
    return sendRedirect(event, "/");
  } catch (err: unknown) {
    log.error(err as Error, { step: "oauth_callback", providerId });
    return sendRedirect(event, errorRedirect);
  }
}
