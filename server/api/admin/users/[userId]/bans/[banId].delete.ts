export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event);

  const userId = getRouterParam(event, "userId");
  const banId = getRouterParam(event, "banId");
  if (!userId || !banId) {
    return { success: false, error: "缺少参数" };
  }

  const result = await removeBan(userId, banId);

  if (result.success) {
    // Audit log via evlog
    console.info("[ban-audit] Ban record removed", {
      operator: admin.userId,
      targetUser: userId,
      removedBan: {
        id: result.removed.id,
        start: result.removed.start,
        end: result.removed.end,
        reason: result.removed.reason,
        operatorId: result.removed.operatorId,
      },
    });
  }

  return { success: result.success, error: result.success ? undefined : result.error };
});
