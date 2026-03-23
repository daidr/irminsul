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

  const formData = await readMultipartFormData(event);
  if (!formData) {
    throw new YggdrasilError(400, "IllegalArgumentException", "Multipart form data required.");
  }

  let model: string | undefined;
  let file: File | undefined;

  for (const part of formData) {
    if (part.name === "model" && part.data) {
      model = part.data.toString("utf-8");
    } else if (part.name === "file" && part.data) {
      file = new File([part.data], part.filename || "texture.png", {
        type: part.type || "image/png",
      });
    }
  }

  if (!file) {
    throw new YggdrasilError(400, "IllegalArgumentException", "Missing texture file.");
  }

  await yggdrasilUploadTexture({
    authorization: getHeader(event, "authorization"),
    uuid,
    textureType,
    model,
    file,
    ip: extractClientIp(event),
  });

  setResponseStatus(event, 204);
  return null;
});
