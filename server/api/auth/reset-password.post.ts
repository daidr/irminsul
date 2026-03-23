import { hasActiveBan } from "~~/server/types/user.schema";

export default defineEventHandler(async (event) => {
  const log = useLogger(event);
  const body = await readBody<{
    token?: string;
    password?: string;
    confirmPassword?: string;
    altchaPayload?: string;
  }>(event);

  const { token, password, confirmPassword, altchaPayload } = body || {};

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

  // Validate password
  if (!password || password.length < 8) {
    return { success: false, error: "密码长度不能少于8个字符" };
  }
  if (password.length > 128) {
    return { success: false, error: "密码长度不能超过128个字符" };
  }
  if (password !== confirmPassword) {
    return { success: false, error: "两次输入的密码不一致" };
  }

  // Validate token
  if (!token) {
    return { success: false, error: "无效的重置链接" };
  }

  // Consume token (one-time use)
  const tokenData = await consumePasswordResetToken(token);
  if (!tokenData) {
    return { success: false, error: "重置链接无效或已过期，请重新发送" };
  }

  // Find user
  const user = await findUserByUuid(tokenData.userId);
  if (!user) {
    return { success: false, error: "用户不存在" };
  }
  if (hasActiveBan(user.bans)) {
    return { success: false, error: "该账户已被封禁" };
  }

  // Hash and update password
  const newHash = await hashPassword(password);
  await updatePasswordHash(user.uuid, newHash, "argon2id");

  // Invalidate all Yggdrasil tokens
  await removeAllTokens(user.uuid);

  // Delete all existing sessions
  await destroyAllSessions(user.uuid);

  log.set({ auth: { action: "password_reset_completed", userId: user.uuid } });
  return { success: true };
});
