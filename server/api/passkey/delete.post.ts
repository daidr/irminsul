import { z } from "zod";

const bodySchema = z.object({
  credentialId: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const user = requireAuth(event);

  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    return { success: false, error: "参数格式错误" };
  }

  const { credentialId } = parsed.data;

  if (!credentialId) {
    return { success: false, error: "缺少凭证 ID" };
  }

  const removed = await removePasskey(user.userId, credentialId);
  if (!removed) return { success: false, error: "通行密钥不存在" };

  return { success: true };
});
