export default defineEventHandler((event) => {
  const log = event.context.log;
  if (!log) return;

  log.set({ clientIp: extractClientIp(event) });

  const user = event.context.user;
  if (user) {
    log.set({
      user: {
        userId: user.userId,
        email: user.email,
        gameId: user.gameId,
        isAdmin: user.isAdmin,
      },
    });
  }
});
