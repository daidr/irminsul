import type { UserDocument } from "~~/server/types/user.schema";

export interface YggdrasilProfile {
  id: string;
  name: string;
  properties?: Array<{
    name: string;
    value: string;
    signature?: string;
  }>;
}

function resolveSkinHash(skinHash?: string): string | undefined {
  const config = useRuntimeConfig();
  const defaultHash = config.yggdrasilDefaultSkinHash || "";
  return skinHash || defaultHash || undefined;
}

type SignedProperty = { name: string; value: string; signature?: string };

/**
 * uploadableTextures property 的值恒为常量 "skin,cape"，其 RSA 签名只需计算一次。
 * 启动时密钥未加载（signature 为空）时不缓存，留待密钥就绪后再算。
 */
let uploadableTexturesProperty: SignedProperty | null = null;
function getUploadableTexturesProperty(): SignedProperty {
  if (uploadableTexturesProperty?.signature) return uploadableTexturesProperty;
  const property = buildProperty("uploadableTextures", "skin,cape");
  if (property.signature) uploadableTexturesProperty = property;
  return property;
}

/**
 * 已签名的 textures property 缓存，避免每次 hasJoined/profile 都做一次 RSA-SHA1 签名
 * （这是 Minecraft 进服的高频热点路径）。
 *
 * 缓存键包含所有进入签名内容的字段；皮肤/披风变更会改变其 hash，从而自然产生新键、
 * 旧键随 LRU 淘汰，无需显式失效。timestamp 取该皮肤状态首次构建的时间——签名是对该
 * payload 整体的签名，仍然有效，客户端不会拿 timestamp 与当前时钟做校验。
 */
const TEXTURES_PROPERTY_CACHE_LIMIT = 2000;
const texturesPropertyCache = new Map<string, SignedProperty>();

function buildTexturesProperty(
  user: UserDocument,
  baseUrl: string,
  skinHash: string | undefined,
): SignedProperty {
  const texturesPayload: Record<string, unknown> = {
    timestamp: Date.now(),
    profileId: stripUuidHyphens(user.uuid),
    profileName: user.gameId,
    textures: {} as Record<string, unknown>,
  };

  const textures = texturesPayload.textures as Record<string, unknown>;

  if (skinHash) {
    textures.SKIN = {
      url: `${baseUrl}/textures/${skinHash}`,
      ...(user.skin?.hash && user.skin.type === 1 ? { metadata: { model: "slim" } } : {}),
    };
  }

  if (user.cape?.hash) {
    textures.CAPE = {
      url: `${baseUrl}/textures/${user.cape.hash}`,
    };
  }

  const valueBase64 = Buffer.from(JSON.stringify(texturesPayload)).toString("base64");
  return buildProperty("textures", valueBase64);
}

/**
 * 构建基础 Profile（用于 authenticate 响应、批量查询）
 */
export function buildBasicProfile(user: Pick<UserDocument, "uuid" | "gameId">): YggdrasilProfile {
  return {
    id: stripUuidHyphens(user.uuid),
    name: user.gameId,
  };
}

/**
 * 构建完整 Profile（包含纹理属性，用于 session/profile 端点）
 */
export function buildFullProfile(user: UserDocument): YggdrasilProfile {
  const config = useRuntimeConfig();
  const baseUrl = config.yggdrasilBaseUrl || "http://localhost:12042";

  const skinHash = resolveSkinHash(user.skin?.hash);
  const skinType = user.skin?.type ?? 0;
  const capeHash = user.cape?.hash ?? "";

  const cacheKey = `${user.uuid}|${user.gameId}|${skinHash ?? ""}|${skinType}|${capeHash}|${baseUrl}`;

  let texturesProperty = texturesPropertyCache.get(cacheKey);
  if (!texturesProperty) {
    texturesProperty = buildTexturesProperty(user, baseUrl, skinHash);
    // 仅缓存已成功签名的结果；超出上限时淘汰最早插入的项（Map 保持插入顺序）
    if (texturesProperty.signature) {
      if (texturesPropertyCache.size >= TEXTURES_PROPERTY_CACHE_LIMIT) {
        const oldest = texturesPropertyCache.keys().next().value;
        if (oldest !== undefined) texturesPropertyCache.delete(oldest);
      }
      texturesPropertyCache.set(cacheKey, texturesProperty);
    }
  }

  return {
    id: stripUuidHyphens(user.uuid),
    name: user.gameId,
    properties: [texturesProperty, getUploadableTexturesProperty()],
  };
}

/**
 * 构建 Yggdrasil user 对象（当 requestUser=true 时使用）
 */
export function buildYggdrasilUser(user: UserDocument) {
  return {
    id: stripUuidHyphens(user.uuid),
    properties: [
      {
        name: "preferredLanguage",
        value: "zh_CN",
      },
    ],
  };
}
