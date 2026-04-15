export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event);

  const userId = getRouterParam(event, "userId");
  const banId = getRouterParam(event, "banId");
  if (!userId || !banId) {
    return { success: false, error: "缺少参数" };
  }

  const result = await removeBan(userId, banId);

  if (result.success) {
    // Audit log as fallback (hook may have no subscribers)
    console.info("[ban-audit] Ban record removed", {
      operator: admin.userId,
      targetUser: userId,
      removedBan: {
        id: banId,
        start: result.removed.start,
        end: result.removed.end,
        reason: result.removed.reason,
        operatorId: result.removed.operatorId,
      },
    });

    emitUserHook("user:ban-deleted", {
      uuid: result.user.uuid,
      email: result.user.email,
      gameId: result.user.gameId,
      banId,
      operator: admin.userId,
      timestamp: Date.now(),
      ban: toBanSnapshot(result.removed),
      wasActive: result.wasActive,
    });
  }

  return result.success ? { success: true } : { success: false, error: result.error };
});
