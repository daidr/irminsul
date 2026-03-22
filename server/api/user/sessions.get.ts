export default defineEventHandler(async (event) => {
  const user = requireAuth(event);
  const currentSessionId = event.context.sessionId as string | null;

  // --- Game sessions (Yggdrasil tokens) ---
  const tokens = await getAllTokens(user.userId);
  const gameSessions = tokens
    .map((t) => ({
      accessToken: t.accessToken,
      label: t.label || "Unknown",
      status: t.status,
      createdIp: t.createdIp || "",
      lastUsedIp: t.lastUsedIp || "",
      lastUsedAt: t.lastUsedAt || t.createdAt,
      createdAt: t.createdAt,
    }))
    .sort((a, b) => {
      if (a.status !== b.status) return b.status - a.status;
      return b.lastUsedAt - a.lastUsedAt;
    });

  // --- Web sessions ---
  const allSessions = await getAllSessions(user.userId);
  const webSessions = allSessions
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

  return {
    success: true,
    gameSessions,
    webSessions,
  };
});
