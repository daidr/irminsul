export default defineEventHandler(async (event) => {
  const user = requireAuth(event);

  const body = await readBody<{
    type?: "skin" | "cape";
    data?: string;
    model?: number;
  }>(event);

  const { type: textureType, data: fileBase64, model } = body || {};

  if (textureType !== "skin" && textureType !== "cape") {
    return { success: false, error: "无效的材质类型" };
  }

  if (!fileBase64) {
    return { success: false, error: "缺少文件数据" };
  }

  // 限制上传大小：1MB base64 ≈ 768KB 二进制，对 64x64 PNG 绰绰有余
  const MAX_BASE64_LENGTH = 1024 * 1024;
  if (fileBase64.length > MAX_BASE64_LENGTH) {
    return { success: false, error: "文件过大，请上传小于 768KB 的图片" };
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
});
