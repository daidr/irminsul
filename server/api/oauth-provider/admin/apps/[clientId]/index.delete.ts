export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const clientId = getRouterParam(event, "clientId");
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: "Missing clientId" });
  }

  const app = await findOAuthAppByClientId(clientId);
  if (!app) {
    throw createError({ statusCode: 404, statusMessage: "App not found" });
  }

  await deleteAllOAuthTokensForClient(clientId);
  await deleteAllOAuthAuthorizationsForClient(clientId);
  await deleteOAuthApp(clientId);

  return { success: true };
});
