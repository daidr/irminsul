export default defineYggdrasilHandler(async (event) => {
  const body = await readValidatedBody(event, invalidateBodySchema.parse);
  await yggdrasilInvalidate(body);

  setResponseStatus(event, 204);
  return null;
});
