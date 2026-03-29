import { z } from "zod";

const bodySchema = z.object({
  model: z.number().optional(),
});

export default defineEventHandler(async (event) => {
  const user = requireAuth(event);

  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    return { success: false, error: "参数格式错误" };
  }
  const skinType = parsed.data.model;

  if (skinType !== 0 && skinType !== 1) {
    return { success: false, error: "无效的模型类型" };
  }

  const updated = await updateSkinModel(user.userId, skinType);
  if (!updated) {
    return { success: false, error: "请先上传皮肤" };
  }

  return { success: true };
});
