import type { SessionData } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    email?: string;
    password?: string;
    altchaPayload?: string;
  }>(event);
  const log = useLogger(event);

  const { email, password, altchaPayload } = body || {};

  // Validate input
  if (!email || !password) {
    return { success: false, error: "请填写邮箱和密码" };
  }

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

  // Find user
  const user = await findUserByEmail(email);
  if (!user) {
    return { success: false, error: "邮箱或密码错误" };
  }

  // Verify password (with legacy migration support)
  const passwordValid = await verifyPassword(password, user.passwordHash, user.hashVersion);
  if (!passwordValid) {
    return { success: false, error: "邮箱或密码错误" };
  }

  // Auto-upgrade legacy password hash to argon2id
  if (user.hashVersion === "legacy") {
    try {
      const newHash = await hashPassword(password);
      await updatePasswordHash(user.uuid, newHash, "argon2id");
      log.set({ auth: { passwordHashUpgraded: true, userId: user.uuid } });
    } catch (err) {
      log.error(err as Error, { step: "password_hash_upgrade", userId: user.uuid });
    }
  }

  const clientIp = extractClientIp(event);
  const ua = getHeader(event, "user-agent") || "unknown";

  // Update last login time and IP
  await updateLastLogin(user.uuid, clientIp);

  // Create session
  const sessionData: SessionData = {
    userId: user.uuid,
    email: user.email,
    gameId: user.gameId,
    ip: clientIp,
    ua,
    loginAt: Date.now(),
  };

  await createSession(event, sessionData);

  return { success: true };
});
