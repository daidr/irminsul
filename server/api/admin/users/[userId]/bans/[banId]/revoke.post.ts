export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event);

  const userId = getRouterParam(event, "userId");
  const banId = getRouterParam(event, "banId");
  if (!userId || !banId) {
    return { success: false, error: "缺少参数" };
  }

  const result = await revokeBan(userId, banId, admin.userId);

  if (result.success) {
    emitUserHook("user:ban-revoked", {
      uuid: result.user.uuid,
      email: result.user.email,
      gameId: result.user.gameId,
      banId,
      operator: admin.userId,
      timestamp: Date.now(),
      ban: toBanSnapshot(result.ban),
    });
  }

  return result.success
    ? { success: true }
    : { success: false, error: result.error };
});
