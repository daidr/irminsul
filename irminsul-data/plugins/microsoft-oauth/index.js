function getTenant(config) {
  return config.tenant === "custom" && config.customTenant
    ? config.customTenant
    : config.tenant || "common";
}

export function setup(ctx) {
  const config = ctx.config.getAll();

  ctx.hook("oauth:provider", () => ({
    id: "microsoft",
    name: "Microsoft",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMSAyMSI+PHJlY3QgeD0iMSIgeT0iMSIgd2lkdGg9IjkiIGhlaWdodD0iOSIgZmlsbD0iI2YyNTAyMiIvPjxyZWN0IHg9IjExIiB5PSIxIiB3aWR0aD0iOSIgaGVpZ2h0PSI5IiBmaWxsPSIjN2ZiYTAwIi8+PHJlY3QgeD0iMSIgeT0iMTEiIHdpZHRoPSI5IiBoZWlnaHQ9IjkiIGZpbGw9IiMwMGE0ZWYiLz48cmVjdCB4PSIxMSIgeT0iMTEiIHdpZHRoPSI5IiBoZWlnaHQ9IjkiIGZpbGw9IiNmZmI5MDAiLz48L3N2Zz4=",
    brandColor: "#2F2F2F",
  }));

  ctx.hook("oauth:authorize", ({ redirectUri, state }) => {
    const tenant = getTenant(ctx.config.getAll());
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: "openid profile email User.Read",
      state,
      response_type: "code",
    });
    return { url: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params}` };
  });

  ctx.hook("oauth:exchange-token", ({ code, redirectUri }) => {
    const tenant = getTenant(ctx.config.getAll());
    return ctx.oauth.exchangeToken(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        code,
        redirectUri,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      },
    );
  });

  ctx.hook("oauth:fetch-profile", ({ accessToken, tokenType }) =>
    ctx.oauth.fetchProfile("https://graph.microsoft.com/v1.0/me", {
      accessToken,
      tokenType,
    }),
  );

  ctx.hook("oauth:map-profile", (raw) => ({
    providerId: String(raw.id),
    displayName: raw.displayName || raw.userPrincipalName,
  }));

  ctx.log.info(`Microsoft OAuth plugin loaded (tenant: ${getTenant(config)})`);
}
