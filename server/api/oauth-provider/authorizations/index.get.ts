export default defineEventHandler(async (event) => {
  const user = requireAuth(event);
  const authorizations = await findOAuthAuthorizationsByUser(user.userId);

  const results = await Promise.all(
    authorizations.map(async (auth) => {
      const app = await findOAuthAppByClientId(auth.clientId);
      return {
        clientId: auth.clientId,
        appName: app?.name ?? null,
        appDescription: app?.description ?? null,
        scopes: auth.scopes,
        grantedAt: auth.grantedAt,
        updatedAt: auth.updatedAt,
      };
    }),
  );

  return results;
});
