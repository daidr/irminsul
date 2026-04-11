import { z } from "zod";
import { useLogger } from "evlog";

const bodySchema = z.object({
  token: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const log = useLogger(event);
  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    return { success: false, error: "参数格式错误" };
  }
  const { token } = parsed.data;

  if (!token) {
    return { success: false, error: "无效的验证链接" };
  }

  const result = await consumeEmailVerificationToken(event, token);
  if (!result) {
    return { success: false, error: "验证链接无效或已过期" };
  }

  // Verify email matches current user email
  const user = await findUserByUuid(result.userId);
  if (!user) {
    return { success: false, error: "用户不存在" };
  }

  if (user.email !== result.email) {
    log.set({ emailVerification: { warning: "email_mismatch", userId: result.userId, tokenEmail: result.email, currentEmail: user.email } });
    return { success: false, error: "邮箱地址已变更，请重新发送验证邮件" };
  }

  if (user.emailVerified) {
    return { success: true } as const;
  }

  await setEmailVerified(result.userId, true);
  await invalidateSessionUserCache(result.userId);
  log.set({ emailVerification: { verified: true, userId: result.userId, email: result.email } });
  return { success: true } as const;
});
