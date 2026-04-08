export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const clientId = getRouterParam(event, "clientId");
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: "Missing clientId" });
  }

  const app = await findOAuthAppByClientId(clientId);
  if (!app) {
    throw createError({ statusCode: 404, statusMessage: "App not found" });
  }

  await approveOAuthApp(clientId, admin.userId);
  return { success: true };
});
