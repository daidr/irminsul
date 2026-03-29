import { createHash } from "node:crypto";

/**
 * 从 accessToken 生成不可逆的 tokenId，用于前端标识和操作 game session，
 * 避免将真实 accessToken 暴露给浏览器。
 */
export function computeTokenId(accessToken: string): string {
  return createHash("sha256").update(accessToken).digest("hex").slice(0, 16);
}
