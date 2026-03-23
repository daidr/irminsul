import { getLogger } from "@logtape/logtape";

const logger = getLogger(["irminsul", "auth"]);

export default defineEventHandler(async (event) => {
  const body = await readBody<{ token?: string }>(event);
  const { token } = body || {};

  if (!token || typeof token !== "string") {
    return { success: false, error: "无效的验证链接" };
  }

  const result = await consumeEmailVerificationToken(token);
  if (!result) {
    return { success: false, error: "验证链接无效或已过期" };
  }

  // Verify email matches current user email
  const user = await findUserByUuid(result.userId);
  if (!user) {
    return { success: false, error: "用户不存在" };
  }

  if (user.email !== result.email) {
    logger.warn`Email verification token email mismatch for user ${result.userId}: token=${result.email}, current=${user.email}`;
    return { success: false, error: "邮箱地址已变更，请重新发送验证邮件" };
  }

  if (user.emailVerified) {
    return { success: true } as const;
  }

  await setEmailVerified(result.userId, true);
  logger.info`Email verified for user ${result.userId} (${result.email})`;
  return { success: true } as const;
});
