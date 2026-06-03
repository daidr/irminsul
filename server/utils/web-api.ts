import type { H3Event } from "h3";
import type { RateLimitOptions } from "./rate-limit";

/**
 * 面向前端 web API 的统一失败响应（HTTP 200 + `{ success: false, error }`）。
 * 保持现有前端契约不变，仅把散落各路由的样板集中到这里。
 */
export interface WebApiFailure {
  success: false;
  error: string;
}

export function webFail(error: string): WebApiFailure {
  return { success: false, error };
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
