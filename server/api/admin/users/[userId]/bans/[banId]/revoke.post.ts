export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event);

  const userId = getRouterParam(event, "userId");
  const banId = getRouterParam(event, "banId");
  if (!userId || !banId) {
    return { success: false, error: "缺少参数" };
  }

  const result = await revokeBan(userId, banId, admin.userId);

  // Emit plugin hook on success
  if (result.success) {
    const target = await findUserByUuid(userId);
    if (target) {
      emitUserHook("user:unbanned", {
        uuid: target.uuid,
        email: target.email,
        gameId: target.gameId,
        timestamp: Date.now(),
        operator: admin.userId,
      });
    }
  }

  return result;
});
