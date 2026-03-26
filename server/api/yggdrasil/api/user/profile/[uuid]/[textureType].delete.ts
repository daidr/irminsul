export default defineYggdrasilHandler(async (event) => {
  const uuid = getRouterParam(event, "uuid");
  const textureType = getRouterParam(event, "textureType");

  if (!uuid || !textureType) {
    throw new YggdrasilError(
      400,
      "IllegalArgumentException",
      "Missing uuid or textureType parameter.",
    );
  }

  await yggdrasilDeleteTexture(event, {
    authorization: getHeader(event, "authorization"),
    uuid,
    textureType,
    ip: extractClientIp(event),
  });

  setResponseStatus(event, 204);
  return null;
});
