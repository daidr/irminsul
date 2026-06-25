import { z } from "zod";

const bodySchema = z.object({
  credentialId: z.string().optional(),
});

export default defineWebApiHandler(async (event) => {
  const user = requireAuth(event);

  const rateLimitFail = await checkWebRateLimit(event, `web:passkey:delete:uid:${user.userId}`, {
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

  const { credentialId } = parsed.data;

  if (!credentialId) {
    webError("缺少凭证 ID");
  }

  const removed = await removePasskey(user.userId, credentialId);
  if (!removed) webError("通行密钥不存在");

  return { success: true };
});
