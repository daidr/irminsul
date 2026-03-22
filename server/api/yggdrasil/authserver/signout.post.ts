export default defineYggdrasilHandler(async (event) => {
  const body = await readValidatedBody(event, signoutBodySchema.parse);
  await checkRateLimit(extractClientIp(event));
  await yggdrasilSignout(body);

  setResponseStatus(event, 204);
  return null;
});
