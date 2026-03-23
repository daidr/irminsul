import { useLogger } from "evlog";

export default defineEventHandler(async (event) => {
  const log = useLogger(event);
  if (!event.context.user) {
    return { success: false, error: "未登录" };
  }

  // Check if email verification is required
  const requireEmailVerification = getSetting("auth.requireEmailVerification");
  if (!requireEmailVerification) {
    return { success: false, error: "当前无需验证邮箱" };
  }

  // Check SMTP configured
  const smtpHost = getSetting("smtp.host");
  if (!smtpHost) {
    return { success: false, error: "邮件服务未配置，请联系管理员" };
  }

  // Fetch user from DB
  const user = await findUserByUuid(event.context.user.userId);
  if (!user) {
    return { success: false, error: "用户不存在" };
  }

  // Already verified
  if (user.emailVerified) {
    return { success: true, message: "你的邮箱已经验证过了" };
  }

  // Create token (includes per-user lock / rate limiting)
  try {
    const token = await createEmailVerificationToken(user.uuid, user.email);
    if (!token) {
      // Lock active — already sent recently
      return { success: true, message: "验证邮件已发送，请检查收件箱" };
    }

    const baseUrl = useRuntimeConfig(event).yggdrasilBaseUrl;
    const verifyLink = `${baseUrl}/verify-email?token=${token}`;
    const sent = await sendEmailVerificationEmail(user.email, verifyLink);
    if (!sent) {
      log.set({ emailVerification: { emailSendFailed: true, email: user.email } });
      return { success: false, error: "邮件发送失败，请稍后重试" };
    }
  } catch (err) {
    log.error(err as Error, { step: "send_verification_email", email: user.email });
    return { success: false, error: "邮件发送失败，请稍后重试" };
  }

  return { success: true, message: "验证邮件已发送，请检查收件箱" };
});
