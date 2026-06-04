import { z } from "zod";
import { useLogger } from "evlog";

const bodySchema = z.object({
  token: z.string().optional(),
});

export default defineWebApiHandler(async (event) => {
  const log = useLogger(event);
  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    webError("参数格式错误");
  }

  // Rate limit by IP
  const rateLimitFail = await checkWebRateLimit(
    event,
    `web:verify-email:ip:${extractClientIp(event)}`,
    {
      duration: 60_000,
      max: 10,
      delayAfter: 5,
      timeWait: 2_000,
      fastFail: true,
    },
  );
  if (rateLimitFail) return rateLimitFail;

  const { token } = parsed.data;

  if (!token) {
    webError("无效的验证链接");
  }

  const result = await consumeEmailVerificationToken(event, token);
  if (!result) {
    webError("验证链接无效或已过期");
  }

  // Verify email matches current user email
  const user = await findUserByUuid(result.userId);
  if (!user) {
    webError("用户不存在");
  }

  if (user.email !== result.email) {
    log.set({
      emailVerification: {
        warning: "email_mismatch",
        userId: result.userId,
        tokenEmail: result.email,
        currentEmail: user.email,
      },
    });
    webError("邮箱地址已变更，请重新发送验证邮件");
  }

  if (user.emailVerified) {
    return { success: true } as const;
  }

  await setEmailVerified(result.userId, true);
  await invalidateSessionUserCache(result.userId);
  log.set({ emailVerification: { verified: true, userId: result.userId, email: result.email } });
  return { success: true } as const;
});
