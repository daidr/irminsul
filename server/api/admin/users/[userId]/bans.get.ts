export default defineEventHandler(async (event) => {
  requireAdmin(event);

  const userId = getRouterParam(event, "userId");
  if (!userId) {
    return { success: false, error: "缺少用户 ID" };
  }

  const bans = await getUserBans(userId);

  // Sort by start descending, limit 200
  const sorted = bans
    .sort((a, b) => b.start.getTime() - a.start.getTime())
    .slice(0, 200);

  return {
    success: true,
    bans: sorted.map((ban) => ({
      id: ban.id,
      start: ban.start.getTime(),
      end: ban.end?.getTime(),
      reason: ban.reason,
      operatorId: ban.operatorId,
      revokedAt: ban.revokedAt?.getTime(),
      revokedBy: ban.revokedBy,
    })),
  };
});
