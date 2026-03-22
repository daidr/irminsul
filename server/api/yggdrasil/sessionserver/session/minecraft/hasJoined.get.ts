export default defineYggdrasilHandler(async (event) => {
  const query = await getValidatedQuery(event, hasJoinedQuerySchema.parse);
  const result = await yggdrasilHasJoined(query);

  if (!result) {
    setResponseStatus(event, 204);
    return null;
  }

  return result;
});
