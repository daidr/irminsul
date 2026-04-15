import { z } from "zod";
import { useLogger } from "evlog";
import type { SessionData } from "~~/server/utils/session";

const bodySchema = z.object({
  email: z.string().optional(),
  password: z.string().optional(),
  altchaPayload: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    return { success: false, error: "参数格式错误" };
  }
  const log = useLogger(event);

  const { email, password, altchaPayload } = parsed.data;

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

  // Rate limit (after Altcha so legitimate users don't waste PoW)
  try {
    await checkRateLimit(event, `web:login:ip:${extractClientIp(event)}`, {
      duration: 60_000,
      max: 10,
      delayAfter: 5,
      timeWait: 2_000,
      fastFail: true,
    });
  } catch (err) {
    if (err instanceof YggdrasilError && err.httpStatus === 429) {
      return { success: false, error: "请求过于频繁，请稍后再试" };
    }
    throw err;
  }

  // Find user
  const user = await findUserByEmail(email);
  if (!user) {
    // Run a dummy verify so timing does not leak user existence
    await dummyPasswordVerify(password);
    return { success: false, error: "邮箱或密码错误" };
  }

  // Verify password (with legacy migration support)
  const passwordValid = await verifyPassword(event, password, user.passwordHash, user.hashVersion);
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

  // Rotate session ID on successful login (防会话固定)
  await destroySession(event);
  await createSession(event, sessionData);

  emitUserHook("user:login", {
    uuid: user.uuid,
    email: user.email,
    gameId: user.gameId,
    ip: clientIp,
    method: "password",
    timestamp: Date.now(),
  });

  return { success: true };
});
