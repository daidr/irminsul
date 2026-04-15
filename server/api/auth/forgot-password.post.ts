import { z } from "zod";
import { useLogger } from "evlog";

const SUCCESS_MESSAGE = "如果该邮箱已注册，我们已发送密码重置链接，请检查收件箱。";

/** Per-email 频率限制：10 分钟内只能请求一次密码重置 */
const RESET_EMAIL_COOLDOWN_SECONDS = 10 * 60;

async function checkEmailResetRateLimit(email: string): Promise<boolean> {
  const redis = getRedisClient();
  const key = buildRedisKey("password-reset-email", email.toLowerCase());
  const result = await redis.send("SET", [
    key,
    "1",
    "EX",
    RESET_EMAIL_COOLDOWN_SECONDS.toString(),
    "NX",
  ]);
  return result !== null;
}

const bodySchema = z.object({
  email: z.string().optional(),
  altchaPayload: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const log = useLogger(event);
  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    return { success: false, error: "参数格式错误" };
  }

  const { email, altchaPayload } = parsed.data;

  if (!altchaPayload) {
    return { success: false, error: "人机验证失败，请重试" };
  }

  // Verify altcha
  const altchaValid = await verifyAltchaPayload(altchaPayload);
  if (!altchaValid) {
    return { success: false, error: "人机验证失败，请重试" };
  }
  if (altchaValid.expired) {
    return { success: false, error: "人机验证已过期，请重试" };
  }
  if (!altchaValid.verified) {
    return { success: false, error: "人机验证失败，请重试" };
  }

  // Rate limit by IP (after altcha so bots burn PoW first)
  try {
    await checkRateLimit(event, `web:forgot-password:ip:${extractClientIp(event)}`, {
      duration: 60_000,
      max: 3,
      delayAfter: 2,
      timeWait: 2_000,
      fastFail: true,
    });
  } catch (err) {
    if (err instanceof YggdrasilError && err.httpStatus === 429) {
      return { success: false, error: "请求过于频繁，请稍后再试" };
    }
    throw err;
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return { success: false, error: "请输入有效的邮箱地址" };
  }

  // Check if SMTP is configured
  const smtpHost = getSetting("smtp.host");
  if (!smtpHost) {
    return { success: false, error: "邮件服务未配置，请联系管理员" };
  }

  // Per-email rate limit (prevent email bombing)
  const allowed = await checkEmailResetRateLimit(email);
  if (!allowed) {
    return { success: true, message: SUCCESS_MESSAGE };
  }

  // Find user (don't reveal whether user exists)
  const user = await findUserByEmail(email);
  if (!user) {
    return { success: true, message: SUCCESS_MESSAGE };
  }

  // Create reset token and send email
  try {
    const token = await createPasswordResetToken(event, user.uuid, user.email);
    if (token) {
      const baseUrl = useRuntimeConfig(event).yggdrasilBaseUrl;
      const resetLink = `${baseUrl}/reset-password?token=${token}`;
      const sent = await sendPasswordResetEmail(event, user.email, resetLink);
      if (!sent) {
        log.set({ passwordReset: { emailSendFailed: true, email: user.email } });
      }
    }
  } catch (err) {
    log.error(err as Error, { step: "password_reset", email });
  }

  return { success: true, message: SUCCESS_MESSAGE };
});
