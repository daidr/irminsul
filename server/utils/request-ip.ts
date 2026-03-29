import type { H3Event } from "h3";

/**
 * 从 H3Event 中提取客户端真实 IP
 *
 * 仅当 runtimeConfig.trustProxy 为 true 时才信任反向代理头
 * （X-Forwarded-For、X-Real-IP），否则使用直连 IP。
 * 通过 IRMIN_TRUST_PROXY=true 环境变量启用。
 */
export function extractClientIp(event: H3Event): string {
  const trustProxy = String(useRuntimeConfig().trustProxy) === "true";

  if (trustProxy) {
    const forwarded = getHeader(event, "x-forwarded-for");
    if (forwarded) {
      const firstIp = forwarded.split(",")[0]?.trim();
      if (firstIp) return firstIp;
    }

    const realIp = getHeader(event, "x-real-ip");
    if (realIp) return realIp;
  }

  return getRequestIP(event) || "unknown";
}
