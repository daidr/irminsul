import { z } from "zod";
import { useLogger } from "evlog";

const bodySchema = z.object({
  token: z.string().optional(),
  password: z.string().optional(),
  confirmPassword: z.string().optional(),
  altchaPayload: z.string().optional(),
});

export default defineWebApiHandler(async (event) => {
  const log = useLogger(event);
  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    webError("参数格式错误");
  }

  const { token, password, confirmPassword, altchaPayload } = parsed.data;

  // Verify altcha
  const altchaFail = await checkWebAltcha(altchaPayload);
  if (altchaFail) return altchaFail;

  // Rate limit by IP
  const rateLimitFail = await checkWebRateLimit(
    event,
    `web:reset-password:ip:${extractClientIp(event)}`,
    {
      duration: 60_000,
      max: 10,
      delayAfter: 5,
      timeWait: 2_000,
      fastFail: true,
    },
  );
  if (rateLimitFail) return rateLimitFail;

  // Validate password
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    webError("密码长度不能少于8个字符");
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    webError("密码长度不能超过128个字符");
  }
  if (password !== confirmPassword) {
    webError("两次输入的密码不一致");
  }

  // Validate token
  if (!token) {
    webError("无效的重置链接");
  }

  // Consume token (one-time use)
  const tokenData = await consumePasswordResetToken(event, token);
  if (!tokenData) {
    webError("重置链接无效或已过期，请重新发送");
  }

  // Find user
  const user = await findUserByUuid(tokenData.userId);
  if (!user) {
    webError("用户不存在");
  }
  // Hash and update password
  const newHash = await hashPassword(password);
  await updatePasswordHash(user.uuid, newHash, "argon2id");
  await invalidateSessionUserCache(user.uuid);

  // Invalidate all Yggdrasil tokens
  await removeAllTokens(user.uuid);

  // Delete all existing sessions
  await destroyAllSessions(user.uuid);

  emitUserHook("user:password-reset", {
    uuid: user.uuid,
    email: user.email,
    gameId: user.gameId,
    ip: extractClientIp(event),
    timestamp: Date.now(),
  });

  log.set({ auth: { action: "password_reset_completed", userId: user.uuid } });
  return { success: true };
});
