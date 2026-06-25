import { z } from "zod";

const bodySchema = z.object({
  model: z.number().optional(),
});

export default defineWebApiHandler(async (event) => {
  const user = requireAuth(event);

  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    webError("参数格式错误");
  }
  const skinType = parsed.data.model;

  if (skinType !== 0 && skinType !== 1) {
    webError("无效的模型类型");
  }

  const updated = await updateSkinModel(user.userId, skinType);
  if (!updated) {
    webError("请先上传皮肤");
  }

  await invalidateSessionUserCache(user.userId);

  return { success: true };
});
