import type { H3Event } from "h3";

/**
 * 从 H3Event 中提取客户端真实 IP
 *
 * 优先读取反向代理设置的标准头（X-Forwarded-For、X-Real-IP），
 * 回退到 h3 的 getRequestIP()。
 */
export function extractClientIp(event: H3Event): string {
  const forwarded = getHeader(event, "x-forwarded-for");
  if (forwarded) {
    const firstIp = forwarded.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }

  const realIp = getHeader(event, "x-real-ip");
  if (realIp) return realIp;

  return getRequestIP(event) || "unknown";
}
