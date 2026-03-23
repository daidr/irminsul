export default defineEventHandler(async (event) => {
  const user = requireAuth(event);

  const body = await readBody<{ type?: "skin" | "cape" }>(event);
  const textureType = body?.type;

  if (textureType !== "skin" && textureType !== "cape") {
    return { success: false, error: "无效的材质类型" };
  }

  try {
    await processTextureDelete({
      uuid: user.userId,
      textureType,
    });

    const config = useRuntimeConfig();
    const defaultHash = config.yggdrasilDefaultSkinHash || "";
    const fallbackSkinHash = textureType === "skin" ? defaultHash || undefined : undefined;

    return { success: true, fallbackSkinHash };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "删除失败",
    };
  }
});
