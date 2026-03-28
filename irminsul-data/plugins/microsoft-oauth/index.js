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
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1em' height='1em' viewBox='0 0 256 256'%3E%3Cpath fill='%23F1511B' d='M121.666 121.666H0V0h121.666z'/%3E%3Cpath fill='%2380CC28' d='M256 121.666H134.335V0H256z'/%3E%3Cpath fill='%2300ADEF' d='M121.663 256.002H0V134.336h121.663z'/%3E%3Cpath fill='%23FBBC09' d='M256 256.002H134.335V134.336H256z'/%3E%3C/svg%3E",
    brandColor: "#2F2F2F",
  }));

  ctx.hook("oauth:authorize", ({ redirectUri, state }) => {
    const tenant = getTenant(ctx.config.getAll());
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: "openid profile User.Read",
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
    displayName: raw.displayName || raw.id,
  }));

  ctx.log.info(`Microsoft OAuth plugin loaded (tenant: ${getTenant(config)})`);
}
