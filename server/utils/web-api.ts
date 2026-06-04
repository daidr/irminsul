import type { EventHandler, H3Event } from "h3";
import type { RateLimitOptions } from "./rate-limit";

/**
 * 面向前端 web API 的统一响应约定（HTTP 200 + `{ success, ... }`）。
 * 保持现有前端契约不变，仅把散落各路由的样板集中到这里。
 */
export interface WebApiFailure {
  success: false;
  error: string;
}
export type WebApiSuccess<T = Record<string, unknown>> = { success: true } & T;
export type ApiResult<T = Record<string, unknown>> = WebApiSuccess<T> | WebApiFailure;

export function webFail(error: string): WebApiFailure {
  return { success: false, error };
}

/** 在 web API 处理器内抛出，以返回标准失败响应（被 defineWebApiHandler 序列化为 `{success:false,error}`）。 */
export class WebApiError extends Error {}

export function webError(message: string): never {
  throw new WebApiError(message);
}

/**
 * 面向前端 web API 的统一处理器包装（对标 defineYggdrasilHandler）。
 * - 处理器正常 return 的对象原样返回（成功路径 `{success:true,...}`、或 helper 返回的失败对象）
 * - 抛出的 WebApiError → `{success:false, error}`（HTTP 200，与既有约定一致）
 * - 其它异常（含限流 YggdrasilError 429）**原样向上抛出**，保持既有传播/状态行为不变
 *
 * 这样路由可用 `throw webError("...")` 取代散落的 `return {success:false,error}`，
 * 而不改变任何现有响应契约——前端无需改动。
 */
export function defineWebApiHandler<T>(
  handler: (event: H3Event) => Promise<ApiResult<T> | T>,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event);
    } catch (err) {
      if (err instanceof WebApiError) {
        return { success: false, error: err.message };
      }
      throw err;
    }
  });
}

/**
 * 校验 Altcha 人机验证。通过返回 null；失败返回标准失败响应，调用方直接 `return` 即可。
 *
 * 等价于此前在 login/register/forgot-password/reset-password/change-password 中逐字重复的
 * 四分支校验块。
 */
export async function checkWebAltcha(
  altchaPayload: string | undefined,
): Promise<WebApiFailure | null> {
  if (!altchaPayload) {
    return webFail("人机验证失败，请重试");
  }
  const altchaValid = await verifyAltchaPayload(altchaPayload);
  if (!altchaValid) {
    return webFail("人机验证失败，请重试");
  }
  if (altchaValid.expired) {
    return webFail("人机验证已过期，请重试");
  }
  if (!altchaValid.verified) {
    return webFail("人机验证失败，请重试");
  }
  return null;
}

/**
 * 执行 web 接口限流。未超限返回 null；触发 429 返回标准失败响应；其它异常原样抛出。
 *
 * 等价于此前 6 个 web 路由里逐字重复的 `try { checkRateLimit } catch (429) { return ... }` 块。
 */
export async function checkWebRateLimit(
  event: H3Event,
  keyIdentifier: string,
  options?: Partial<RateLimitOptions>,
): Promise<WebApiFailure | null> {
  try {
    await checkRateLimit(event, keyIdentifier, options);
    return null;
  } catch (err) {
    if (err instanceof YggdrasilError && err.httpStatus === 429) {
      return webFail("请求过于频繁，请稍后再试");
    }
    throw err;
  }
}
