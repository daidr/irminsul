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

  if (app.type !== "confidential") {
    throw createError({
      statusCode: 400,
      statusMessage: "Only confidential apps have client secrets",
    });
  }

  const newSecret = generateClientSecret();
  const newHash = await Bun.password.hash(newSecret, "argon2id");

  await updateOAuthApp(clientId, { clientSecretHash: newHash });
  await revokeAllOAuthTokensForClient(clientId);

  return { success: true, clientSecret: newSecret };
});
