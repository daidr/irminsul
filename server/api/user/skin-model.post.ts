export default defineEventHandler(async (event) => {
  const user = requireAuth(event);

  const body = await readBody<{ model?: number }>(event);
  const skinType = body?.model;

  if (skinType !== 0 && skinType !== 1) {
    return { success: false, error: "无效的模型类型" };
  }

  const updated = await updateSkinModel(user.userId, skinType);
  if (!updated) {
    return { success: false, error: "请先上传皮肤" };
  }

  return { success: true };
});
