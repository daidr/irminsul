export default defineYggdrasilHandler(async (event) => {
  const uuid = getRouterParam(event, "uuid");
  if (!uuid) {
    throw new YggdrasilError(400, "IllegalArgumentException", "Missing uuid parameter.");
  }

  const result = await yggdrasilGetProfile(uuid);

  if (!result) {
    setResponseStatus(event, 204);
    return null;
  }

  return result;
});
