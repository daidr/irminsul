export default defineEventHandler(async (event) => {
  const user = requireAuth(event);
  const currentSessionId = event.context.sessionId as string | null;

  const body = await readBody<{ sessionId?: string }>(event);
  const { sessionId } = body || {};

  if (!sessionId) {
    return { success: false, error: "缺少会话标识" };
  }

  if (sessionId === currentSessionId) {
    return { success: false, error: "不能删除当前会话" };
  }

  await destroySessionById(user.userId, sessionId);
  return { success: true };
});
