export default defineEventHandler(async (event) => {
  const user = requireDeveloper(event);
  const apps = await findOAuthAppsByOwner(user.userId);
  return apps.map(({ clientSecretHash, ...rest }) => rest);
});
