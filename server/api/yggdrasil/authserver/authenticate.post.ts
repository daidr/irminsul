export default defineYggdrasilHandler(async (event) => {
  const body = await readValidatedBody(event, authenticateBodySchema.parse);
  await checkRateLimit(event, extractClientIp(event));

  return yggdrasilAuthenticate(event, {
    ...body,
    ip: extractClientIp(event),
    userAgent: getHeader(event, "user-agent") || "",
  });
});
