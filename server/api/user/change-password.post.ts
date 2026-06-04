import { z } from "zod";
import { useLogger } from "evlog";

const bodySchema = z.object({
  oldPassword: z.string().optional(),
  newPassword: z.string().optional(),
  confirmPassword: z.string().optional(),
  altchaPayload: z.string().optional(),
});

export default defineWebApiHandler(async (event) => {
  const log = useLogger(event);
  const user = requireAuth(event);

  // Rate limit by user (prevent old-password guessing)
  const rateLimitFail = await checkWebRateLimit(
    event,
    `web:change-password:uid:${user.userId}`,
    {
      duration: 60_000,
      max: 5,
      delayAfter: 3,
      timeWait: 2_000,
      fastFail: true,
    },
  );
  if (rateLimitFail) return rateLimitFail;

  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    webError("参数格式错误");
  }

  const { oldPassword, newPassword, confirmPassword, altchaPayload } = parsed.data;

  // Verify altcha
  const altchaFail = await checkWebAltcha(altchaPayload);
  if (altchaFail) return altchaFail;

  // Validate inputs
  if (!oldPassword) {
    webError("请输入旧密码");
  }
  if (!newPassword || newPassword.length < PASSWORD_MIN_LENGTH) {
    webError("新密码长度不能少于8个字符");
  }
  if (newPassword.length > PASSWORD_MAX_LENGTH) {
    webError("新密码长度不能超过128个字符");
  }
  if (newPassword !== confirmPassword) {
    webError("两次输入的新密码不一致");
  }

  // Find user
  const userDoc = await findUserByUuid(user.userId);
  if (!userDoc) {
    webError("用户不存在");
  }

  // Verify old password
  const passwordValid = await verifyPassword(
    event,
    oldPassword,
    userDoc.passwordHash,
    userDoc.hashVersion,
  );
  if (!passwordValid) {
    webError("旧密码错误");
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
