import type { EventHandler, H3Event } from "h3";
import type { OAuthScope } from "../types/oauth-provider.types";

/** 已通过 scope 校验的 OAuth bearer token 信息 */
export interface OAuthBearerInfo {
  userId: string | null;
  scopes: OAuthScope[];
  clientId: string;
}

export interface OAuthResourceContext {
  tokenInfo: OAuthBearerInfo;
}

/**
 * OAuth Provider 资源路由统一包装器（对标 defineYggdrasilHandler）。
 *
 * 收敛所有资源路由共享的横切关注点：
 *  - oauth.enabled 总开关（未启用返回 404）
 *  - CORS 头（Access-Control-Allow-Origin: *）
 *  - bearer token + scope 校验
 *  - OAuthError → 标准 OAuth 错误响应 `{ error, error_description }` + 对应状态码
 *
 * 非 OAuthError（如 createError 抛出的 4xx）原样向上抛出，交由 h3 正常处理，
 * 因此 400/404 等语义保持不变。
 */
export function defineOAuthResourceHandler<T>(
  requiredScopes: OAuthScope[],
  handler: (event: H3Event, ctx: OAuthResourceContext) => Promise<T>,
): EventHandler {
  return defineEventHandler(async (event) => {
    // OAuth 总开关（保持与原路由一致：在设置 CORS 之前判断）
    if (!getSetting("oauth.enabled")) {
      throw createError({ statusCode: 404, statusMessage: "OAuth is not enabled" });
    }

    // CORS
    setResponseHeader(event, "Access-Control-Allow-Origin", "*");

    try {
      const tokenInfo = (await requireOAuthBearer(event, requiredScopes)) as OAuthBearerInfo;
      return await handler(event, { tokenInfo });
    } catch (err) {
      if (err instanceof OAuthError) {
        setResponseStatus(event, err.statusCode);
        return { error: err.errorCode, error_description: err.errorDescription };
      }
      throw err;
    }
  });
}

/** 提取 uuid 路由参数，缺失则 400 */
export function getRequiredUuidParam(event: H3Event): string {
  const uuid = getRouterParam(event, "uuid");
  if (!uuid) {
    throw createError({ statusCode: 400, statusMessage: "Missing uuid parameter" });
  }
  return uuid;
}

/**
 * 提取 uuid 路由参数并校验当前 token 拥有者只能操作自己的资源。
 * 非自有资源抛出 OAuthError(access_denied, 403)，由包装器序列化为标准响应。
 */
export function requireProfileOwnership(event: H3Event, tokenInfo: OAuthBearerInfo): string {
  const uuid = getRequiredUuidParam(event);
  if (tokenInfo.userId !== uuid) {
    throw new OAuthError("access_denied", "Cannot modify another user's textures", 403);
  }
  return uuid;
}
