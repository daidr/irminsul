export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const uuid = getRouterParam(event, "uuid");
  if (!uuid) {
    throw createError({ statusCode: 400, statusMessage: "Missing uuid" });
  }

  const user = await findUserByUuid(uuid);
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  await setDeveloperStatus(uuid, false);
  return { success: true };
});
