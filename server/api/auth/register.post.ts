import { z } from "zod";
import { randomUUIDv7 } from "bun";
import { MongoServerError } from "mongodb";
import type { UserDocument } from "~~/server/types/user.schema";

const GAME_ID_REGEX = /^[a-zA-Z0-9_]{4,12}$/;

/**
 * 生成版本位为 0 的 UUIDv7，避免与官方 UUID 冲突
 */
function generateUuid(): string {
  return randomUUIDv7().replace(/^(.{14})./, "$10");
}

const bodySchema = z.object({
  email: z.string().optional(),
  gameId: z.string().optional(),
  password: z.string().optional(),
  confirmPassword: z.string().optional(),
  altchaPayload: z.string().optional(),
});

export default defineWebApiHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event));
  if (!parsed.success) {
    webError("参数格式错误");
  }

  const { email, gameId, password, confirmPassword, altchaPayload } = parsed.data;

  // Validate input
  if (!email || !gameId || !password || !confirmPassword) {
    webError("请填写所有必填字段");
  }

  // Validate email format
  if (!EMAIL_REGEX.test(email)) {
    webError("邮箱格式不正确");
  }

  // Validate game ID
  if (!GAME_ID_REGEX.test(gameId)) {
    webError("游戏昵称仅支持字母、数字、下划线，长度4-12个字符");
  }

  // Validate password length
  if (password.length < PASSWORD_MIN_LENGTH) {
    webError("密码长度不能少于8个字符");
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    webError("密码长度不能超过128个字符");
  }

  // Confirm password match
  if (password !== confirmPassword) {
    webError("两次输入的密码不一致");
  }

  // Verify altcha
  const altchaFail = await checkWebAltcha(altchaPayload);
  if (altchaFail) return altchaFail;

  // Rate limit (after Altcha so legitimate users don't waste PoW)
  const rateLimitFail = await checkWebRateLimit(
    event,
    `web:register:ip:${extractClientIp(event)}`,
    {
      duration: 60_000,
      max: 5,
      delayAfter: 2,
      timeWait: 2_000,
      fastFail: true,
    },
  );
  if (rateLimitFail) return rateLimitFail;

  // Check uniqueness
  if (await emailExists(email)) {
    webError("该邮箱已被注册");
  }
  if (await gameIdExists(gameId)) {
    webError("该游戏昵称已被使用");
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Generate UUID
  const uuid = generateUuid();

  // Get IP
  const clientIp = extractClientIp(event);

  // Insert user
  const now = new Date();
  const userDoc: Omit<UserDocument, "_id" | "isAdmin"> = {
    gameId,
    email: email.toLowerCase(),
    emailVerified: false,
    uuid,
    passwordHash,
    hashVersion: "argon2id",
    skin: null,
    cape: null,
    bans: [],
    tokens: [],
    passkeys: [],
    ip: {
      register: clientIp,
      lastLogged: null,
    },
    time: {
      register: now,
      lastLogged: null,
    },
  };

  try {
    await insertUser(userDoc);
  } catch (err: unknown) {
    if (err instanceof MongoServerError && err.code === 11000) {
      webError("邮箱或游戏昵称已被使用");
    }
    webError("注册失败，请稍后重试");
  }

  emitUserHook("user:registered", {
    uuid: userDoc.uuid,
    email: userDoc.email,
    gameId: userDoc.gameId,
    ip: clientIp,
    timestamp: Date.now(),
  });

  return { success: true };
});
