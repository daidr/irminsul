import { randomUUID } from "node:crypto";

// === Types ===

export interface OAuthProviderDescriptor {
  id: string;
  name: string;
  icon: string;
  brandColor: string;
}

export interface OAuthMappedProfile {
  providerId: string;
  displayName: string;
}

export interface OAuthStateData {
  action: "bind" | "login";
  userId?: string;
  providerId: string;
}

// === State ===

const OAUTH_STATE_TTL = 300; // 5 minutes

export async function createOAuthState(data: OAuthStateData): Promise<string> {
  const state = randomUUID().replace(/-/g, "");
  const redis = getRedisClient();
  const key = buildRedisKey("oauth", "state", state);
  await redis.send("SET", [key, JSON.stringify(data), "EX", OAUTH_STATE_TTL.toString()]);
  return state;
}

export async function consumeOAuthState(state: string): Promise<OAuthStateData | null> {
  const redis = getRedisClient();
  const key = buildRedisKey("oauth", "state", state);
  const raw = (await redis.send("GETDEL", [key])) as string | null;
  if (!raw) return null;
  return JSON.parse(raw) as OAuthStateData;
}

// === URL Builder ===

export function buildCallbackUrl(providerId: string): string {
  const config = useRuntimeConfig();
  const baseUrl = (config.yggdrasilBaseUrl as string)?.replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("IRMIN_YGGDRASIL_BASE_URL is not configured, OAuth callbacks require it");
  }
  return `${baseUrl}/api/oauth/${providerId}/callback`;
}
