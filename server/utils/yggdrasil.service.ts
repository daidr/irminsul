import type { H3Event } from "h3";
import { useLogger } from "evlog";
import type { YggdrasilToken } from "~~/server/types/user.schema";
import { hasActiveBan } from "~~/server/types/user.schema";

// --- authenticate ---

export async function yggdrasilAuthenticate(event: H3Event, params: {
  username: string;
  password: string;
  clientToken?: string;
  requestUser?: boolean;
  ip: string;
  userAgent: string;
}) {
  const user = await findUserByEmail(params.username);
  if (!user || hasActiveBan(user.bans)) {
    throw new YggdrasilError(
      403,
      "ForbiddenOperationException",
      "Invalid credentials. Invalid username or password.",
    );
  }

  const valid = await verifyPassword(event, params.password, user.passwordHash, user.hashVersion);
  if (!valid) {
    throw new YggdrasilError(
      403,
      "ForbiddenOperationException",
      "Invalid credentials. Invalid username or password.",
    );
  }

  // 渐进式密码哈希迁移
  if (user.hashVersion !== "argon2id") {
    const newHash = await hashPassword(params.password);
    await updatePasswordHash(user.uuid, newHash, "argon2id");
    useLogger(event).set({ auth: { passwordHashMigrated: true, userId: user.email, from: user.hashVersion } });
  }

  // 邮箱验证检查
  const requireEmailVerification = await getSetting("auth.requireEmailVerification");
  if (requireEmailVerification && !user.emailVerified) {
    throw new YggdrasilError(403, "ForbiddenOperationException", "Email not verified.");
  }

  const accessToken = crypto.randomUUID().replace(/-/g, "");
  const clientToken = params.clientToken || crypto.randomUUID().replace(/-/g, "");
  const now = Date.now();

  const token: YggdrasilToken = {
    accessToken,
    clientToken,
    status: 1,
    createdAt: now,
    label: parseLauncherLabel(params.userAgent),
    createdIp: params.ip,
    lastUsedIp: params.ip,
    lastUsedAt: now,
  };

  await addToken(user.uuid, token);

  const profile = buildBasicProfile(user);
  const response: Record<string, unknown> = {
    accessToken,
    clientToken,
    availableProfiles: [profile],
    selectedProfile: profile,
  };

  if (params.requestUser) {
    response.user = buildYggdrasilUser(user);
  }

  useLogger(event).set({ yggdrasil: { action: "authenticate", userId: user.email } });
  return response;
}

// --- refresh ---

export async function yggdrasilRefresh(params: {
  accessToken: string;
  clientToken?: string;
  requestUser?: boolean;
  ip: string;
}) {
  // 按 accessToken 查找令牌（不检查 status，与 GHAuth 一致）
  const result = await findTokenByAccessToken(params.accessToken, params.clientToken);
  if (!result) {
    throw new YggdrasilError(403, "ForbiddenOperationException", "Invalid token.");
  }

  const { user, token } = result;

  // 封禁检查
  if (hasActiveBan(user.bans)) {
    throw new YggdrasilError(403, "ForbiddenOperationException", "Invalid token.");
  }

  // 过期检查 — 过期则物理删除
  const config = useRuntimeConfig();
  const expiryMs = config.yggdrasilTokenExpiryMs || 432000000;
  if (Date.now() - token.createdAt > expiryMs) {
    await removeToken(params.accessToken);
    throw new YggdrasilError(403, "ForbiddenOperationException", "Invalid token.");
  }

  // 重新激活令牌（设回 status=1），不生成新令牌
  await reactivateToken(params.accessToken, params.ip);

  // 返回原 accessToken/clientToken（与 GHAuth 一致）
  const profile = buildBasicProfile(user);
  const response: Record<string, unknown> = {
    accessToken: token.accessToken,
    clientToken: token.clientToken,
    selectedProfile: profile,
  };

  if (params.requestUser) {
    response.user = buildYggdrasilUser(user);
  }

  return response;
}

// --- validate ---

export async function yggdrasilValidate(params: {
  accessToken: string;
  clientToken?: string;
  ip: string;
}): Promise<boolean> {
  const result = await validateAccessToken(params.accessToken, params.clientToken, params.ip);
  return result !== null;
}

// --- invalidate ---

export async function yggdrasilInvalidate(params: { accessToken: string }): Promise<void> {
  await removeToken(params.accessToken);
}

// --- signout ---

export async function yggdrasilSignout(event: H3Event, params: {
  username: string;
  password: string;
}): Promise<void> {
  const user = await findUserByEmail(params.username);
  if (!user) {
    throw new YggdrasilError(
      403,
      "ForbiddenOperationException",
      "Invalid credentials. Invalid username or password.",
    );
  }

  const valid = await verifyPassword(event, params.password, user.passwordHash, user.hashVersion);
  if (!valid) {
    throw new YggdrasilError(
      403,
      "ForbiddenOperationException",
      "Invalid credentials. Invalid username or password.",
    );
  }

  // 渐进式密码哈希迁移
  if (user.hashVersion !== "argon2id") {
    const newHash = await hashPassword(params.password);
    await updatePasswordHash(user.uuid, newHash, "argon2id");
    useLogger(event).set({ auth: { passwordHashMigrated: true, userId: user.email, from: user.hashVersion } });
  }

  await removeAllTokens(user.uuid);
}

// --- join ---

const JOIN_TTL = 15; // seconds

export async function yggdrasilJoin(params: {
  accessToken: string;
  selectedProfile: string;
  serverId: string;
  ip: string;
}): Promise<void> {
  const result = await validateAccessToken(params.accessToken, undefined, params.ip);
  if (!result) {
    throw new YggdrasilError(403, "ForbiddenOperationException", "Invalid token.");
  }

  const { user } = result;

  if (!user.emailVerified) {
    throw new YggdrasilError(403, "ForbiddenOperationException", "Email not verified.");
  }

  if (params.selectedProfile !== stripUuidHyphens(user.uuid)) {
    throw new YggdrasilError(403, "ForbiddenOperationException", "Invalid profile.");
  }

  // 存储 serverId -> uuid 映射到 Redis
  const redis = getRedisClient();
  const key = buildRedisKey("yggdrasil", `join_${params.serverId}`);
  await redis.send("SET", [key, user.uuid, "EX", JOIN_TTL.toString()]);
}

// --- hasJoined ---

export async function yggdrasilHasJoined(params: {
  username: string;
  serverId: string;
  ip?: string;
}) {
  const redis = getRedisClient();
  const key = buildRedisKey("yggdrasil", `join_${params.serverId}`);
  const uuid = await redis.send("GET", [key]);

  if (!uuid) return null;

  const user = await findUserByUuid(uuid as string);
  if (!user) return null;
  if (user.gameId !== params.username) return null;

  return buildFullProfile(user);
}

// --- profile ---

export async function yggdrasilGetProfile(uuidHex: string) {
  if (uuidHex.length !== 32) return null;
  const uuidWithHyphens = addUuidHyphens(uuidHex);
  const user = await findUserByUuid(uuidWithHyphens);
  if (!user) return null;

  return buildFullProfile(user);
}

// --- Bearer 认证 ---

async function authenticateBearer(authorization: string | undefined, ip?: string) {
  if (!authorization?.startsWith("Bearer ")) {
    throw new YggdrasilError(401, "Unauthorized", "Invalid token.");
  }
  const accessToken = authorization.slice(7);
  const result = await validateAccessToken(accessToken, undefined, ip);
  if (!result) {
    throw new YggdrasilError(401, "Unauthorized", "Invalid token.");
  }
  return result;
}

// --- 材质上传 ---

export async function yggdrasilUploadTexture(event: H3Event, params: {
  authorization: string | undefined;
  uuid: string;
  textureType: string;
  model?: string;
  file: File;
  ip: string;
}): Promise<void> {
  const { user } = await authenticateBearer(params.authorization, params.ip);

  // UUID 归属检查
  if (stripUuidHyphens(user.uuid) !== params.uuid) {
    throw new YggdrasilError(403, "ForbiddenOperationException", "You don't own this profile.");
  }

  // 邮箱验证检查
  const requireEmailVerification = await getSetting("auth.requireEmailVerification");
  if (requireEmailVerification && !user.emailVerified) {
    throw new YggdrasilError(403, "ForbiddenOperationException", "Email not verified.");
  }

  // 验证材质类型
  if (params.textureType !== "skin" && params.textureType !== "cape") {
    throw new YggdrasilError(400, "IllegalArgumentException", "Invalid texture type.");
  }

  const buffer = Buffer.from(await params.file.arrayBuffer());
  try {
    await processTextureUpload(event, {
      uuid: user.uuid,
      textureType: params.textureType,
      model: params.model === "slim" ? 1 : 0,
      fileBuffer: buffer,
    });
  } catch (error) {
    throw new YggdrasilError(
      400,
      "IllegalArgumentException",
      error instanceof Error ? error.message : "Upload failed.",
    );
  }

  useLogger(event).set({ yggdrasil: { textureAction: "upload", type: params.textureType, gameId: user.gameId } });
}

// --- 材质删除 ---

export async function yggdrasilDeleteTexture(event: H3Event, params: {
  authorization: string | undefined;
  uuid: string;
  textureType: string;
  ip: string;
}): Promise<void> {
  const { user } = await authenticateBearer(params.authorization, params.ip);

  // UUID 归属检查
  if (stripUuidHyphens(user.uuid) !== params.uuid) {
    throw new YggdrasilError(403, "ForbiddenOperationException", "You don't own this profile.");
  }

  // 验证材质类型
  if (params.textureType !== "skin" && params.textureType !== "cape") {
    throw new YggdrasilError(400, "IllegalArgumentException", "Invalid texture type.");
  }

  try {
    await processTextureDelete(event, {
      uuid: user.uuid,
      textureType: params.textureType,
    });
  } catch (error) {
    throw new YggdrasilError(
      400,
      "IllegalArgumentException",
      error instanceof Error ? error.message : "Delete failed.",
    );
  }

  useLogger(event).set({ yggdrasil: { textureAction: "delete", type: params.textureType, gameId: user.gameId } });
}

// --- batch profiles ---

export async function yggdrasilBatchProfiles(playernames: string[]) {
  if (!Array.isArray(playernames) || playernames.length === 0) return [];
  const limited = playernames
    .filter((name, index, arr) => typeof name === "string" && arr.indexOf(name) === index)
    .slice(0, 10);
  const users = await findUsersByGameIds(limited);
  return users.map(buildBasicProfile);
}

// --- player certificates ---

import { CERT_EXPIRY_MS } from "~~/server/utils/yggdrasil.crypto";
const CERT_TTL_SECONDS = Math.floor(CERT_EXPIRY_MS / 1000); // 48h in seconds

export async function yggdrasilPlayerCertificates(authorization: string | undefined, ip: string) {
  const { user } = await authenticateBearer(authorization, ip);

  const redis = getRedisClient();
  const cacheKey = buildRedisKey("yggdrasil", `player_cert:${user.uuid}`);
  const cached = await redis.send("GET", [cacheKey]);
  if (cached) {
    return JSON.parse(cached as string);
  }

  const result = generatePlayerCertificates(user.uuid);

  await redis.send("SET", [cacheKey, JSON.stringify(result), "EX", CERT_TTL_SECONDS.toString()]);

  return result;
}
