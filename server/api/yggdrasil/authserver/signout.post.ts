export default defineYggdrasilHandler(async (event) => {
  const body = await readValidatedBody(event, signoutBodySchema.parse);
  await checkRateLimit(event, extractClientIp(event));
  await yggdrasilSignout(event, body);

  setResponseStatus(event, 204);
  return null;
});
