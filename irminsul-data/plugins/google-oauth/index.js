export function setup(ctx) {
  const config = ctx.config.getAll();

  ctx.hook("oauth:provider", () => ({
    id: "google",
    name: "Google",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxOCAxOCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xNy42NCA5LjJjMC0uNjMtLjA2LTEuMjUtLjE2LTEuODRIOXYzLjQ4aDQuODRhNC4xNCA0LjE0IDAgMDEtMS44IDIuNzJ2Mi4yNmgyLjkyYTguNzggOC43OCAwIDAwMi42OC02LjYyeiIvPjxwYXRoIGQ9Ik05IDE4YzIuNDMgMCA0LjQ3LS44IDUuOTYtMi4xOGwtMi45Mi0yLjI2Yy0uOC41NC0xLjgzLjg2LTMuMDQuODYtMi4zNCAwLTQuMzMtMS41OC01LjA0LTMuNzFILjk2djIuMzNBOC45OSA4Ljk5IDAgMDA5IDE4eiIvPjxwYXRoIGQ9Ik0zLjk2IDEwLjcxQTUuNDEgNS40MSAwIDAxMy42OCA5YzAtLjU5LjEtMS4xNy4yOC0xLjcxVjQuOTZILjk2QTguOTkgOC45OSAwIDAwMCA5YzAgMS40NS4zNSAyLjgyLjk2IDQuMDRsMy0yLjMzeiIvPjxwYXRoIGQ9Ik05IDMuNThjMS4zMiAwIDIuNS40NSAzLjQ0IDEuMzVsMi41OC0yLjU4QzEzLjQ2Ljg5IDExLjQzIDAgOSAwQTguOTkgOC45OSAwIDAwLjk2IDQuOTZsMyAyLjMzQzQuNjcgNS4xNiA2LjY2IDMuNTggOSAzLjU4eiIvPjwvc3ZnPg==",
    brandColor: "#4285F4",
  }));

  ctx.hook("oauth:authorize", ({ redirectUri, state }) => {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: "openid profile email",
      state,
      response_type: "code",
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
  });

  ctx.hook("oauth:exchange-token", ({ code, redirectUri }) =>
    ctx.oauth.exchangeToken("https://oauth2.googleapis.com/token", {
      code,
      redirectUri,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    }),
  );

  ctx.hook("oauth:fetch-profile", ({ accessToken, tokenType }) =>
    ctx.oauth.fetchProfile("https://www.googleapis.com/oauth2/v3/userinfo", {
      accessToken,
      tokenType,
    }),
  );

  ctx.hook("oauth:map-profile", (raw) => ({
    providerId: String(raw.sub),
    displayName: raw.name || raw.email,
  }));

  ctx.log.info("Google OAuth plugin loaded");
}
