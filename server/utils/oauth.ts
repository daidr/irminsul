import { randomUUID } from "node:crypto";

// === Types ===

export interface OAuthProviderDescriptor {
  id: string;
  name: string;
  icon: string;
  brandColor: string;
  authorize: {
    url: string;
    scopes: string[];
  };
  token: {
    url: string;
  };
  userInfo?: {
    url: string;
    headers?: Record<string, string>;
  };
}

export interface OAuthMappedProfile {
  providerId: string;
  displayName: string;
}

export interface OAuthExchangeTokenArgs {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}

export interface OAuthTokenResult {
  accessToken: string;
  tokenType?: string;
}

export interface OAuthFetchProfileArgs {
  accessToken: string;
  tokenType: string;
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
  const raw = (await redis.send("GET", [key])) as string | null;
  if (!raw) return null;
  await redis.send("DEL", [key]);
  return JSON.parse(raw) as OAuthStateData;
}

// === Default OAuth 2.0 Flow ===

export async function defaultExchangeToken(
  tokenUrl: string,
  args: OAuthExchangeTokenArgs,
): Promise<OAuthTokenResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: args.clientId,
    client_secret: args.clientSecret,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const accessToken = data.access_token as string;
  if (!accessToken) {
    throw new Error("Token exchange response missing access_token");
  }

  return {
    accessToken,
    tokenType: (data.token_type as string) ?? "Bearer",
  };
}

export async function defaultFetchProfile(
  userInfoUrl: string,
  accessToken: string,
  tokenType: string,
  headers?: Record<string, string>,
): Promise<unknown> {
  const res = await fetch(userInfoUrl, {
    headers: {
      Authorization: `${tokenType} ${accessToken}`,
      Accept: "application/json",
      ...headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`User info fetch failed (${res.status}): ${text}`);
  }

  return res.json();
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
