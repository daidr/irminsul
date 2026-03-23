export default defineEventHandler(async (event) => {
  const user = requireAuth(event);
  const currentSessionId = event.context.sessionId as string | null;

  const allSessions = await getAllSessions(user.userId);
  const sessions = allSessions
    .map((s) => ({
      sessionId: s.sessionId,
      ip: s.data.ip,
      ua: s.data.ua,
      loginAt: s.data.loginAt,
      isCurrent: s.sessionId === currentSessionId,
    }))
    .sort((a, b) => {
      if (a.isCurrent) return -1;
      if (b.isCurrent) return 1;
      return b.loginAt - a.loginAt;
    });

  return { success: true, sessions };
});
