export default defineEventHandler(async (event) => {
  const user = requireAuth(event);

  const body = await readBody<{ accessToken?: string }>(event);
  const { accessToken } = body || {};

  if (!accessToken) {
    return { success: false, error: "缺少令牌标识" };
  }

  const userDoc = await findUserByUuid(user.userId);
  if (!userDoc) {
    return { success: false, error: "用户不存在" };
  }

  const tokenBelongsToUser = userDoc.tokens.some((t) => t.accessToken === accessToken);
  if (!tokenBelongsToUser) {
    return { success: false, error: "无权操作" };
  }

  await removeToken(accessToken);
  return { success: true };
});
