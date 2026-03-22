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

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    email?: string;
    gameId?: string;
    password?: string;
    confirmPassword?: string;
    altchaPayload?: string;
  }>(event);

  const { email, gameId, password, confirmPassword, altchaPayload } = body || {};

  // Validate input
  if (!email || !gameId || !password || !confirmPassword) {
    return { success: false, error: "请填写所有必填字段" };
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { success: false, error: "邮箱格式不正确" };
  }

  // Validate game ID
  if (!GAME_ID_REGEX.test(gameId)) {
    return {
      success: false,
      error: "游戏昵称仅支持字母、数字、下划线，长度4-12个字符",
    };
  }

  // Validate password length
  if (password.length < 8) {
    return { success: false, error: "密码长度不能少于8个字符" };
  }
  if (password.length > 128) {
    return { success: false, error: "密码长度不能超过128个字符" };
  }

  // Confirm password match
  if (password !== confirmPassword) {
    return { success: false, error: "两次输入的密码不一致" };
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

  // Check uniqueness
  if (await emailExists(email)) {
    return { success: false, error: "该邮箱已被注册" };
  }
  if (await gameIdExists(gameId)) {
    return { success: false, error: "该游戏昵称已被使用" };
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
      return { success: false, error: "邮箱或游戏昵称已被使用" };
    }
    return { success: false, error: "注册失败，请稍后重试" };
  }

  return { success: true };
});
