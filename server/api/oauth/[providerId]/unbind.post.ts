export default defineEventHandler(async (event) => {
  const user = requireAuth(event);
  const providerId = getRouterParam(event, "providerId");

  if (!providerId) {
    throw createError({ statusCode: 400, statusMessage: "Missing providerId" });
  }

  const removed = await removeOAuthBinding(user.userId, providerId);
  if (!removed) {
    throw createError({ statusCode: 404, statusMessage: "No binding found for this provider" });
  }

  await invalidateSessionUserCache(user.userId);

  emitUserHook("user:oauth-bindchanged", {
    uuid: user.userId,
    email: user.email,
    gameId: user.gameId,
    action: "unbind",
    provider: providerId,
    timestamp: Date.now(),
  });

  return { success: true };
});
