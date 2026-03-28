export function setup(ctx) {
  const config = ctx.config.getAll();

  ctx.hook("oauth:provider", () => ({
    id: "discord",
    name: "Discord",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xMy41NDUgMi45MDdhMTMuMiAxMy4yIDAgMCAwLTMuMjU3LTEuMDExLjA1LjA1IDAgMCAwLS4wNTIuMDI1Yy0uMTQxLjI1LS4yOTcuNTc3LS40MDYuODMzYTEyLjIgMTIuMiAwIDAgMC0zLjY1OCAwIDguMyA4LjMgMCAwIDAtLjQxMi0uODMzLjA1LjA1IDAgMCAwLS4wNTItLjAyNWMtMS4xMjUuMTk0LTIuMjIuNTM0LTMuMjU3IDEuMDExYS4wNC4wNCAwIDAgMC0uMDIxLjAxOEMuMzU2IDYuMDI0LS4yMTMgOS4wNDcuMDY2IDEyLjAzMnEuMDAzLjAyMi4wMjEuMDM3YTEzLjMgMTMuMyAwIDAgMCAzLjk5NiAyLjAyLjA1LjA1IDAgMCAwIC4wNTYtLjAxOWMuMzA4LS40Mi41ODItLjg2My44MTgtMS4zMjlhLjA1LjA1IDAgMCAwLS4wMjgtLjA3IDguNyA4LjcgMCAwIDEtMS4yNDgtLjU5NS4wNS4wNSAwIDAgMS0uMDA1LS4wODNxLjEyNS0uMDkzLjI0OC0uMTk1YS4wNS4wNSAwIDAgMSAuMDUxLS4wMDdjMi42MTkgMS4xOTYgNS40NTQgMS4xOTYgOC4wNDEgMGEuMDUuMDUgMCAwIDEgLjA1My4wMDdxLjEyMS4xLjI0OC4xOTVhLjA1LjA1IDAgMCAxLS4wMDQuMDgzIDguMiA4LjIgMCAwIDEtMS4yNDkuNTk0LjA1LjA1IDAgMCAwLS4wMjcuMDdjLjI0LjQ2NS41MTUuOTA5LjgxNyAxLjMyOWEuMDUuMDUgMCAwIDAgLjA1Ni4wMTkgMTMuMiAxMy4yIDAgMCAwIDQuMDAxLTIuMDIuMDUuMDUgMCAwIDAgLjAyMS0uMDM3Yy4zMzQtMy40NTEtLjU1OS02LjQ0OS0yLjM2Ni05LjEwNmEuMDMuMDMgMCAwIDAtLjAyLS4wMTltLTguMTk4IDcuMzA3Yy0uNzg5IDAtMS40MzgtLjcyNC0xLjQzOC0xLjYxMnMuNjM3LTEuNjEzIDEuNDM4LTEuNjEzYy44MDcgMCAxLjQ1LjczIDEuNDM4IDEuNjEzIDAgLjg4OC0uNjM3IDEuNjEyLTEuNDM4IDEuNjEybTUuMzE2IDBjLS43ODggMC0xLjQzOC0uNzI0LTEuNDM4LTEuNjEycy42MzctMS42MTMgMS40MzgtMS42MTNjLjgwNyAwIDEuNDUxLjczIDEuNDM4IDEuNjEzIDAgLjg4OC0uNjMxIDEuNjEyLTEuNDM4IDEuNjEyIi8+PC9zdmc+",
    brandColor: "#5865F2",
  }));

  ctx.hook("oauth:authorize", ({ redirectUri, state }) => {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: "identify",
      state,
      response_type: "code",
    });
    return { url: `https://discord.com/oauth2/authorize?${params}` };
  });

  ctx.hook("oauth:exchange-token", ({ code, redirectUri }) =>
    ctx.oauth.exchangeToken("https://discord.com/api/oauth2/token", {
      code,
      redirectUri,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    }),
  );

  ctx.hook("oauth:fetch-profile", ({ accessToken, tokenType }) =>
    ctx.oauth.fetchProfile("https://discord.com/api/users/@me", {
      accessToken,
      tokenType,
    }),
  );

  ctx.hook("oauth:map-profile", (raw) => ({
    providerId: String(raw.id),
    displayName: raw.global_name || raw.username,
  }));

  ctx.log.info("Discord OAuth plugin loaded");
}
