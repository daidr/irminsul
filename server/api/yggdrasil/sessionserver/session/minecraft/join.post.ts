export default defineYggdrasilHandler(async (event) => {
  const body = await readValidatedBody(event, joinBodySchema.parse);
  await yggdrasilJoin({
    ...body,
    ip: extractClientIp(event),
  });

  setResponseStatus(event, 204);
  return null;
});
