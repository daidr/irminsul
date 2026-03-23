import type { Collection } from "mongodb";
import type {
  UserDocument,
  UserSkin,
  UserCape,
  YggdrasilToken,
  PasskeyRecord,
} from "~~/server/types/user.schema";
import { hasActiveBan } from "~~/server/types/user.schema";

const COLLECTION_NAME = "users";

export function getUserCollection(): Collection<UserDocument> {
  return getDb().collection<UserDocument>(COLLECTION_NAME);
}

/**
 * 确保索引存在，启动时调用一次
 */
export async function ensureUserIndexes(): Promise<void> {
  const col = getUserCollection();
  await col.createIndex({ email: 1 }, { unique: true });
  await col.createIndex({ gameId: 1 }, { unique: true });
  await col.createIndex({ uuid: 1 }, { unique: true });
  await col.createIndex({ "skin.hash": 1 }, { sparse: true });
  await col.createIndex({ "cape.hash": 1 }, { sparse: true });
  await col.createIndex(
    { "passkeys.credentialId": 1 },
    { unique: true, partialFilterExpression: { "passkeys.credentialId": { $exists: true } } },
  );
  const log = createLogger({ category: "db" });
  log.set({ action: "ensureUserIndexes", status: "complete" });
  log.emit();
}

// --- 查询 ---

export async function findUserByEmail(email: string): Promise<UserDocument | null> {
  return getUserCollection().findOne({ email: email.toLowerCase() });
}

export async function findUserByGameId(gameId: string): Promise<UserDocument | null> {
  return getUserCollection().findOne({ gameId });
}

export async function findUserByUuid(uuid: string): Promise<UserDocument | null> {
  return getUserCollection().findOne({ uuid });
}

/** Session 中间件专用：仅查询必要字段，排除 tokens 等大字段 */
export async function findUserForSession(
  uuid: string,
): Promise<Pick<
  UserDocument,
  "skin" | "cape" | "bans" | "time" | "isAdmin" | "emailVerified"
> | null> {
  return getUserCollection().findOne(
    { uuid },
    { projection: { skin: 1, cape: 1, bans: 1, time: 1, isAdmin: 1, emailVerified: 1 } },
  ) as Promise<Pick<
    UserDocument,
    "skin" | "cape" | "bans" | "time" | "isAdmin" | "emailVerified"
  > | null>;
}

export async function findUsersByGameIds(
  gameIds: string[],
): Promise<Pick<UserDocument, "uuid" | "gameId">[]> {
  return getUserCollection()
    .find({ gameId: { $in: gameIds } }, { projection: { uuid: 1, gameId: 1 } })
    .toArray() as Promise<Pick<UserDocument, "uuid" | "gameId">[]>;
}

export async function emailExists(email: string): Promise<boolean> {
  const count = await getUserCollection().countDocuments(
    { email: email.toLowerCase() },
    { limit: 1 },
  );
  return count > 0;
}

export async function gameIdExists(gameId: string): Promise<boolean> {
  const count = await getUserCollection().countDocuments({ gameId }, { limit: 1 });
  return count > 0;
}

/**
 * 插入新用户，返回插入后的完整文档
 * 首个注册用户自动成为管理员
 */
export async function insertUser(
  doc: Omit<UserDocument, "_id" | "isAdmin">,
): Promise<UserDocument> {
  const col = getUserCollection();
  const count = await col.countDocuments({}, { limit: 1 });
  const fullDoc = { ...doc, isAdmin: count === 0 } as UserDocument;
  const result = await col.insertOne(fullDoc);
  return { ...fullDoc, _id: result.insertedId } as UserDocument;
}

/**
 * 更新密码哈希和版本（用于渐进式迁移）
 */
export async function updatePasswordHash(
  uuid: string,
  newHash: string,
  newVersion: "argon2id",
): Promise<void> {
  await getUserCollection().updateOne(
    { uuid },
    {
      $set: {
        passwordHash: newHash,
        hashVersion: newVersion,
      },
    },
  );
}

/**
 * 更新最后登录时间和 IP
 */
export async function updateLastLogin(uuid: string, ip: string): Promise<void> {
  await getUserCollection().updateOne(
    { uuid },
    {
      $set: {
        "time.lastLogged": new Date(),
        "ip.lastLogged": ip,
      },
    },
  );
}

/**
 * 更新邮箱验证状态
 */
export async function setEmailVerified(uuid: string, verified: boolean): Promise<void> {
  await getUserCollection().updateOne({ uuid }, { $set: { emailVerified: verified } });
}

// --- 材质操作 ---

/**
 * 更新用户皮肤
 */
export async function updateUserSkin(uuid: string, skin: UserSkin | null): Promise<void> {
  await getUserCollection().updateOne({ uuid }, { $set: { skin } });
}

/**
 * 更新用户披风
 */
export async function updateUserCape(uuid: string, cape: UserCape | null): Promise<void> {
  await getUserCollection().updateOne({ uuid }, { $set: { cape } });
}

/**
 * 仅更新皮肤模型类型（Steve/Alex），要求用户已有皮肤
 */
export async function updateSkinModel(uuid: string, type: 0 | 1): Promise<boolean> {
  const result = await getUserCollection().updateOne(
    { uuid, skin: { $ne: null } },
    { $set: { "skin.type": type } },
  );
  return result.modifiedCount > 0;
}

/**
 * 检查指定材质哈希是否仍有用户在使用（skin 或 cape）
 */
export async function isTextureHashInUse(hash: string): Promise<boolean> {
  const count = await getUserCollection().countDocuments(
    {
      $or: [{ "skin.hash": hash }, { "cape.hash": hash }],
    },
    { limit: 1 },
  );
  return count > 0;
}

// --- Yggdrasil Token 操作 ---

/**
 * 添加新令牌（同时失效所有现有活跃令牌），更新最后登录时间
 */
export async function addToken(uuid: string, token: YggdrasilToken): Promise<void> {
  const col = getUserCollection();
  const expiryMs = Number(useRuntimeConfig().yggdrasilTokenExpiryMs) || 432000000;
  const cutoff = Date.now() - expiryMs;

  // 失效所有活跃令牌 + 移除过期令牌 + 推入新令牌 + 更新最后登录时间
  await col.updateOne({ uuid }, [
    {
      $set: {
        tokens: {
          $concatArrays: [
            {
              $map: {
                input: {
                  $filter: {
                    input: "$tokens",
                    cond: { $gte: ["$$this.createdAt", cutoff] },
                  },
                },
                in: { $mergeObjects: ["$$this", { status: 0 }] },
              },
            },
            [token],
          ],
        },
        "time.lastLogged": new Date(),
      },
    },
  ]);
}

/**
 * 验证 accessToken 有效性（要求 status === 1）
 */
export async function validateAccessToken(
  accessToken: string,
  clientToken?: string,
  ip?: string,
): Promise<{ user: UserDocument; token: YggdrasilToken } | null> {
  const user = await getUserCollection().findOne({
    tokens: {
      $elemMatch: {
        accessToken,
        status: 1,
      },
    },
  });

  if (!user || hasActiveBan(user.bans)) return null;

  const token = user.tokens.find(
    (t: YggdrasilToken) => t.accessToken === accessToken && t.status === 1,
  );
  if (!token) return null;

  // clientToken 匹配检查
  if (clientToken !== undefined && token.clientToken !== clientToken) return null;

  // 过期检查 — 过期则物理删除
  const expiryMs = Number(useRuntimeConfig().yggdrasilTokenExpiryMs) || 432000000;
  if (Date.now() - token.createdAt > expiryMs) {
    await removeToken(accessToken);
    return null;
  }

  // 更新令牌最后使用信息
  if (ip) {
    await updateTokenLastUsed(accessToken, ip);
  }

  return { user, token };
}

/**
 * 查找 accessToken 对应的用户和令牌（不检查 status，用于 refresh）
 */
export async function findTokenByAccessToken(
  accessToken: string,
  clientToken?: string,
): Promise<{ user: UserDocument; token: YggdrasilToken } | null> {
  const user = await getUserCollection().findOne({
    tokens: {
      $elemMatch: { accessToken },
    },
  });

  if (!user) return null;

  const token = user.tokens.find((t: YggdrasilToken) => t.accessToken === accessToken);
  if (!token) return null;

  // clientToken 匹配检查
  if (clientToken !== undefined && token.clientToken !== clientToken) return null;

  return { user, token };
}

/**
 * 重新激活令牌（将 status 设为 1，更新最后使用信息）
 */
export async function reactivateToken(accessToken: string, ip: string): Promise<void> {
  await getUserCollection().updateOne(
    { "tokens.accessToken": accessToken },
    {
      $set: {
        "tokens.$.status": 1,
        "tokens.$.lastUsedIp": ip,
        "tokens.$.lastUsedAt": Date.now(),
      },
    },
  );
}

/**
 * 物理移除单个令牌（从数组中删除）
 */
export async function removeToken(accessToken: string): Promise<boolean> {
  const result = await getUserCollection().updateOne(
    { "tokens.accessToken": accessToken },
    { $pull: { tokens: { accessToken } } },
  );
  return result.modifiedCount > 0;
}

/**
 * 物理移除用户的所有令牌
 */
export async function removeAllTokens(uuid: string): Promise<void> {
  await getUserCollection().updateOne({ uuid }, { $set: { tokens: [] } });
}

/**
 * 更新令牌最后使用信息
 */
export async function updateTokenLastUsed(accessToken: string, ip: string): Promise<void> {
  await getUserCollection().updateOne(
    { "tokens.accessToken": accessToken, "tokens.status": 1 },
    {
      $set: {
        "tokens.$.lastUsedIp": ip,
        "tokens.$.lastUsedAt": Date.now(),
      },
    },
  );
}

/**
 * 获取用户的所有未过期令牌（用于会话管理，包含已失效的）
 */
export async function getAllTokens(uuid: string): Promise<YggdrasilToken[]> {
  const expiryMs = Number(useRuntimeConfig().yggdrasilTokenExpiryMs) || 432000000;
  const cutoff = Date.now() - expiryMs;

  const user = await getUserCollection().findOne({ uuid }, { projection: { tokens: 1 } });
  if (!user) return [];

  return user.tokens.filter((t: YggdrasilToken) => t.createdAt >= cutoff);
}

// --- 通行密钥操作 ---

const MAX_PASSKEYS = 10;

/**
 * 通过 credentialId 查找用户（通行密钥登录用）
 */
export async function findUserByPasskeyCredentialId(
  credentialId: string,
): Promise<UserDocument | null> {
  return getUserCollection().findOne({ "passkeys.credentialId": credentialId });
}

/**
 * 添加通行密钥（上限 10 个）
 */
export async function addPasskey(uuid: string, passkey: PasskeyRecord): Promise<boolean> {
  const result = await getUserCollection().updateOne(
    { uuid, [`passkeys.${MAX_PASSKEYS - 1}`]: { $exists: false } },
    { $push: { passkeys: passkey } },
  );
  return result.modifiedCount > 0;
}

/**
 * 删除通行密钥
 */
export async function removePasskey(uuid: string, credentialId: string): Promise<boolean> {
  const result = await getUserCollection().updateOne(
    { uuid },
    { $pull: { passkeys: { credentialId } } },
  );
  return result.modifiedCount > 0;
}

/**
 * 重命名通行密钥
 */
export async function renamePasskey(
  uuid: string,
  credentialId: string,
  newLabel: string,
): Promise<boolean> {
  const result = await getUserCollection().updateOne(
    { uuid, "passkeys.credentialId": credentialId },
    { $set: { "passkeys.$.label": newLabel } },
  );
  return result.modifiedCount > 0;
}

/**
 * 更新通行密钥的 counter 和 lastUsedAt
 */
export async function updatePasskeyUsage(
  uuid: string,
  credentialId: string,
  counter: number,
): Promise<void> {
  await getUserCollection().updateOne(
    { uuid, "passkeys.credentialId": credentialId },
    { $set: { "passkeys.$.counter": counter, "passkeys.$.lastUsedAt": new Date() } },
  );
}

/**
 * 获取用户的通行密钥列表（不含公钥，用于展示）
 */
export async function getPasskeys(uuid: string): Promise<Omit<PasskeyRecord, "publicKey">[]> {
  const user = await getUserCollection().findOne({ uuid }, { projection: { passkeys: 1 } });
  if (!user || !user.passkeys) return [];
  return user.passkeys.map(({ publicKey: _publicKey, ...rest }) => rest);
}
