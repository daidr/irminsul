export default defineEventHandler(async (event) => {
  const user = requireAuth(event);

  const body = await readBody<{
    action: "upload" | "delete" | "updateModel";
    textureType?: "skin" | "cape";
    fileBase64?: string;
    model?: number;
    skinType?: 0 | 1;
  }>(event);

  const { action, textureType, fileBase64, model, skinType } = body || {};

  if (action === "upload") {
    if (textureType !== "skin" && textureType !== "cape") {
      return { success: false, error: "无效的材质类型" };
    }

    if (!fileBase64) {
      return { success: false, error: "缺少文件数据" };
    }

    // Check email verification requirement
    const requireEmailVerification = getSetting("auth.requireEmailVerification");
    if (requireEmailVerification) {
      const userDoc = await findUserByUuid(user.userId);
      if (userDoc && !userDoc.emailVerified) {
        return { success: false, error: "请先验证邮箱" };
      }
    }

    const fileBuffer = Buffer.from(fileBase64, "base64");

    try {
      const result = await processTextureUpload({
        uuid: user.userId,
        textureType,
        model,
        fileBuffer,
      });
      return { success: true, hash: result.hash };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "上传失败",
      };
    }
  }

  if (action === "delete") {
    if (textureType !== "skin" && textureType !== "cape") {
      return { success: false, error: "无效的材质类型" };
    }

    try {
      await processTextureDelete({
        uuid: user.userId,
        textureType,
      });

      // If deleting skin, return fallback hash
      const config = useRuntimeConfig();
      const defaultHash = config.yggdrasilDefaultSkinHash || "";
      const fallbackSkinHash = textureType === "skin" ? (defaultHash || undefined) : undefined;

      return { success: true, fallbackSkinHash };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "删除失败",
      };
    }
  }

  if (action === "updateModel") {
    if (skinType !== 0 && skinType !== 1) {
      return { success: false, error: "无效的模型类型" };
    }

    const updated = await updateSkinModel(user.userId, skinType);
    if (!updated) {
      return { success: false, error: "请先上传皮肤" };
    }

    return { success: true };
  }

  return { success: false, error: "无效的操作" };
});
