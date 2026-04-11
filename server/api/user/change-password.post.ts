import { z } from "zod";
import { useLogger } from "evlog";

const bodySchema = z.object({
  oldPassword: z.string().optional(),
  newPassword: z.string().optional(),
  confirmPassword: z.string().optional(),
  altchaPayload: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const log = useLogger(event);
  const user = requireAuth(event);

  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    return { success: false, error: "参数格式错误" };
  }

  const { oldPassword, newPassword, confirmPassword, altchaPayload } = parsed.data;

  // Verify altcha
  if (!altchaPayload) {
    return { success: false, error: "人机验证失败，请重试" };
  }
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

  // Validate inputs
  if (!oldPassword) {
    return { success: false, error: "请输入旧密码" };
  }
  if (!newPassword || newPassword.length < 8) {
    return { success: false, error: "新密码长度不能少于8个字符" };
  }
  if (newPassword.length > 128) {
    return { success: false, error: "新密码长度不能超过128个字符" };
  }
  if (newPassword !== confirmPassword) {
    return { success: false, error: "两次输入的新密码不一致" };
  }

  // Find user
  const userDoc = await findUserByUuid(user.userId);
  if (!userDoc) {
    return { success: false, error: "用户不存在" };
  }

  // Verify old password
  const passwordValid = await verifyPassword(
    event,
    oldPassword,
    userDoc.passwordHash,
    userDoc.hashVersion,
  );
  if (!passwordValid) {
    return { success: false, error: "旧密码错误" };
  }

  // Hash and update password
  const newHash = await hashPassword(newPassword);
  await updatePasswordHash(userDoc.uuid, newHash, "argon2id");
  await invalidateSessionUserCache(userDoc.uuid);

  // Invalidate all Yggdrasil tokens
  await removeAllTokens(userDoc.uuid);

  // Delete all sessions (including current)
  await destroyAllSessions(userDoc.uuid);

  // Clear current session cookie (sessions already destroyed above)
  deleteCookie(event, "irmin_session", {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV !== "development",
  });

  emitUserHook("user:password-changed", {
    uuid: userDoc.uuid,
    email: userDoc.email,
    gameId: userDoc.gameId,
    ip: extractClientIp(event),
    timestamp: Date.now(),
  });

  log.set({ auth: { action: "password_changed", userId: userDoc.uuid } });
  return { success: true };
});
