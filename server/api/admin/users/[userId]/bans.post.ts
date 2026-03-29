export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event);

  const userId = getRouterParam(event, "userId");
  if (!userId) {
    return { success: false, error: "缺少用户 ID" };
  }

  // Prevent self-ban
  if (userId === admin.userId) {
    return { success: false, error: "不能封禁自己" };
  }

  const body = (await readBody<{ end?: string; reason?: string }>(event)) ?? {};

  // Validate reason length
  if (body.reason && body.reason.length > 500) {
    return { success: false, error: "封禁理由不能超过 500 个字符" };
  }

  // Validate and parse end date
  let endDate: Date | undefined;
  if (body.end) {
    endDate = new Date(body.end);
    if (isNaN(endDate.getTime())) {
      return { success: false, error: "截止时间格式无效" };
    }
    if (endDate <= new Date()) {
      return { success: false, error: "截止时间必须是未来时间" };
    }
  }

  const result = await addBan(
    userId,
    { end: endDate, reason: body.reason || undefined },
    admin.userId,
  );

  // Emit plugin hook on success
  if (result.success) {
    const target = await findUserByUuid(userId);
    if (target) {
      emitUserHook("user:banned", {
        uuid: target.uuid,
        email: target.email,
        gameId: target.gameId,
        timestamp: Date.now(),
        reason: body.reason || undefined,
        end: endDate?.getTime(),
        operator: admin.userId,
      });
    }
  }

  return result;
});
