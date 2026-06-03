export default defineOAuthResourceHandler(["profile:read"], async (event) => {
  const uuid = getRequiredUuidParam(event);

  const user = await findUserByUuid(uuid);
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  return {
    uuid: user.uuid,
    gameId: user.gameId,
    skin: user.skin,
    cape: user.cape,
  };
});
