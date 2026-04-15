import { z } from "zod";

const bodySchema = z.object({
  credentialId: z.string().optional(),
  newLabel: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const user = requireAuth(event);

  try {
    await checkRateLimit(event, `web:passkey:rename:uid:${user.userId}`, {
      duration: 60_000,
      max: 20,
      delayAfter: 10,
      timeWait: 1_000,
      fastFail: true,
    });
  } catch (err) {
    if (err instanceof YggdrasilError && err.httpStatus === 429) {
      return { success: false, error: "请求过于频繁，请稍后再试" };
    }
    throw err;
  }

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
