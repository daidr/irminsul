export default defineEventHandler(async (event) => {
  const user = requireDeveloper(event);
  const clientId = getRouterParam(event, "clientId");
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: "Missing clientId" });
  }

  const app = await findOAuthAppByClientId(clientId);
  if (!app) {
    throw createError({ statusCode: 404, statusMessage: "App not found" });
  }

  if (app.ownerId !== user.userId && !user.isAdmin) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const { clientSecretHash, ...rest } = app;
  return rest;
});
