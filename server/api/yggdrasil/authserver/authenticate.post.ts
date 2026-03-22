export default defineYggdrasilHandler(async (event) => {
  const body = await readValidatedBody(event, authenticateBodySchema.parse);
  await checkRateLimit(extractClientIp(event));

  return yggdrasilAuthenticate({
    ...body,
    ip: extractClientIp(event),
    userAgent: getHeader(event, "user-agent") || "",
  });
});
