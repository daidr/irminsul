export default defineEventHandler(async (event) => {
  requireAdmin(event);

  const userId = getRouterParam(event, "userId");
  if (!userId) {
    return { success: false, error: "缺少用户 ID" };
  }

  const user = await findUserByUuid(userId);
  if (!user) {
    return { success: false, error: "用户不存在" };
  }

  const defaultSkinHash = useRuntimeConfig(event).yggdrasilDefaultSkinHash;

  return {
    success: true,
    user: {
      uuid: user.uuid,
      gameId: user.gameId,
      skinHash: user.skin?.hash || defaultSkinHash || undefined,
      skinSlim: user.skin?.type === 1,
      isAdmin: user.isAdmin,
    },
  };
});
