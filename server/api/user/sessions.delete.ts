export default defineEventHandler(async (event) => {
  const user = requireAuth(event);
  const currentSessionId = event.context.sessionId as string | null;

  const body = await readBody<{
    type: "game" | "web";
    id?: string; // accessToken for game, sessionId for web
    all?: boolean; // true = delete all (game tokens or other web sessions)
  }>(event);

  const { type, id, all } = body || {};

  if (type === "game") {
    if (all) {
      // Invalidate all Yggdrasil tokens
      await removeAllTokens(user.userId);
      return { success: true };
    }

    if (!id) {
      return { success: false, error: "缺少令牌标识" };
    }

    // Verify the token belongs to the current user
    const userDoc = await findUserByUuid(user.userId);
    if (!userDoc) {
      return { success: false, error: "用户不存在" };
    }

    const tokenBelongsToUser = userDoc.tokens.some((t) => t.accessToken === id);
    if (!tokenBelongsToUser) {
      return { success: false, error: "无权操作" };
    }

    await removeToken(id);
    return { success: true };
  }

  if (type === "web") {
    if (all) {
      // Delete all other web sessions (keep current)
      if (currentSessionId) {
        await destroyOtherSessions(user.userId, currentSessionId);
      }
      return { success: true };
    }

    if (!id) {
      return { success: false, error: "缺少会话标识" };
    }

    // Cannot delete current session
    if (id === currentSessionId) {
      return { success: false, error: "不能删除当前会话" };
    }

    await destroySessionById(user.userId, id);
    return { success: true };
  }

  return { success: false, error: "无效的操作类型" };
});
