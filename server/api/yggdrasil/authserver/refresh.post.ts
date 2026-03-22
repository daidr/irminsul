export default defineYggdrasilHandler(async (event) => {
  const body = await readValidatedBody(event, refreshBodySchema.parse);

  return yggdrasilRefresh({
    ...body,
    ip: extractClientIp(event),
  });
});
