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

  const texturesPayload: Record<string, unknown> = {
    timestamp: Date.now(),
    profileId: stripUuidHyphens(user.uuid),
    profileName: user.gameId,
    textures: {} as Record<string, unknown>,
  };

  const textures = texturesPayload.textures as Record<string, unknown>;

  const skinHash = resolveSkinHash(user.skin?.hash);
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

  const texturesProperty = buildProperty("textures", valueBase64);

  const uploadableTexturesProperty = buildProperty("uploadableTextures", "skin,cape");

  return {
    id: stripUuidHyphens(user.uuid),
    name: user.gameId,
    properties: [texturesProperty, uploadableTexturesProperty],
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
