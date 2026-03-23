export default defineYggdrasilHandler(async (event) => {
  const body = await readValidatedBody(event, validateBodySchema.parse);
  const valid = await yggdrasilValidate({
    ...body,
    ip: extractClientIp(event),
  });

  if (!valid) {
    throw new YggdrasilError(403, "ForbiddenOperationException", "Invalid token.");
  }

  setResponseStatus(event, 204);
  return null;
});
