export default defineEventHandler(async (event) => {
  const user = requireAuth(event);

  const tokens = await getAllTokens(user.userId);
  const sessions = tokens
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

  return { success: true, sessions };
});
