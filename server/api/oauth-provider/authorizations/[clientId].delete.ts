export default defineEventHandler(async (event) => {
  const user = requireAuth(event);
  const clientId = getRouterParam(event, "clientId");
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: "Missing clientId" });
  }

  await revokeAllOAuthTokensForUserAndClient(clientId, user.userId);
  await deleteOAuthAuthorization(clientId, user.userId);

  return { success: true };
});
