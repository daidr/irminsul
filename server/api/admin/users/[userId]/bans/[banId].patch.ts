export default defineEventHandler(async (event) => {
  requireAdmin(event);

  const userId = getRouterParam(event, "userId");
  const banId = getRouterParam(event, "banId");
  if (!userId || !banId) {
    return { success: false, error: "缺少参数" };
  }

  const body = (await readBody<{ end?: string | null; reason?: string }>(event)) ?? {};

  if (body.reason !== undefined && body.reason.length > 500) {
    return { success: false, error: "封禁理由不能超过 500 个字符" };
  }

  let endDate: Date | null | undefined;
  if (body.end === null) {
    endDate = null; // make permanent
  } else if (body.end !== undefined) {
    endDate = new Date(body.end);
    if (isNaN(endDate.getTime())) {
      return { success: false, error: "截止时间格式无效" };
    }
    // No future-time check here: editing historical records may need past dates
  }

  const result = await editBan(userId, banId, {
    end: endDate,
    reason: body.reason,
  });

  return result;
});
