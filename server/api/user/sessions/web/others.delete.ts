export default defineEventHandler(async (event) => {
  const user = requireAuth(event);
  const currentSessionId = event.context.sessionId as string | null;

  if (currentSessionId) {
    await destroyOtherSessions(user.userId, currentSessionId);
  }

  return { success: true };
});
