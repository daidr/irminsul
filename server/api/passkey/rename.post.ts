import { z } from "zod";

const bodySchema = z.object({
  credentialId: z.string().optional(),
  newLabel: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const user = requireAuth(event);

  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    return { success: false, error: "参数格式错误" };
  }

  const { credentialId, newLabel } = parsed.data;

  if (!credentialId || !newLabel) {
    return { success: false, error: "参数不完整" };
  }

  const trimmed = newLabel.trim();
  if (!trimmed) return { success: false, error: "名称不能为空" };
  if (trimmed.length > 50) return { success: false, error: "名称最长 50 个字符" };

  const updated = await renamePasskey(user.userId, credentialId, trimmed);
  if (!updated) return { success: false, error: "通行密钥不存在" };

  return { success: true };
});
