import { z } from "zod";

const bodySchema = z.object({
  credentialId: z.string().optional(),
  newLabel: z.string().optional(),
});

export default defineWebApiHandler(async (event) => {
  const user = requireAuth(event);

  const rateLimitFail = await checkWebRateLimit(event, `web:passkey:rename:uid:${user.userId}`, {
    duration: 60_000,
    max: 20,
    delayAfter: 10,
    timeWait: 1_000,
    fastFail: true,
  });
  if (rateLimitFail) return rateLimitFail;

  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    webError("参数格式错误");
  }

  const { credentialId, newLabel } = parsed.data;

  if (!credentialId || !newLabel) {
    webError("参数不完整");
  }

  const trimmed = newLabel.trim();
  if (!trimmed) webError("名称不能为空");
  if (trimmed.length > 50) webError("名称最长 50 个字符");

  const updated = await renamePasskey(user.userId, credentialId, trimmed);
  if (!updated) webError("通行密钥不存在");

  return { success: true };
});
