import { createHash, randomBytes } from "node:crypto";
import type { OAuthAuthorizationCodeData, OAuthScope } from "../types/oauth-provider.types";
import type { OAuthAppDocument } from "../types/oauth-app.schema";

// ─── Generators ───

export function generateClientId(): string {
  return randomBytes(16).toString("hex");
}

export function generateClientSecret(): string {
  return randomBytes(36).toString("base64url");
}

export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ─── PKCE ───

export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash("sha256").update(codeVerifier).digest("base64url");
  return computed === codeChallenge;
}

// ─── Authorization Code (Redis) ───

export async function storeAuthorizationCode(
  code: string,
  data: OAuthAuthorizationCodeData,
): Promise<void> {
  const key = buildRedisKey("oauth", "code", hashToken(code));
  const ttl = (getSetting("oauth.authorizationCodeTtlS") as number) || 60;
  const redis = getRedisClient();
  await redis.send("SET", [key, JSON.stringify(data), "EX", ttl.toString()]);
}

export async function consumeAuthorizationCode(
  code: string,
): Promise<OAuthAuthorizationCodeData | null> {
  const key = buildRedisKey("oauth", "code", hashToken(code));
  const redis = getRedisClient();
  const raw = await redis.send("GETDEL", [key]);
  if (!raw) return null;
  return JSON.parse(raw as string);
}

// ─── Client Authentication ───

export class OAuthError extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly errorDescription: string,
    public readonly statusCode: number = 400,
  ) {
    super(errorDescription);
  }
}

export async function authenticateClient(
  clientId: string,
  clientSecret: string | undefined,
): Promise<OAuthAppDocument> {
  const app = await findOAuthAppByClientId(clientId);
  if (!app) {
    throw new OAuthError("invalid_client", "Unknown client", 401);
  }
  if (!app.approved) {
    throw new OAuthError("invalid_client", "Client not approved", 401);
  }

  if (app.type === "confidential") {
    if (!clientSecret) {
      throw new OAuthError("invalid_client", "Client secret required", 401);
    }
    const valid = await Bun.password.verify(clientSecret, app.clientSecretHash!);
    if (!valid) {
      throw new OAuthError("invalid_client", "Invalid client secret", 401);
    }
  } else {
    if (clientSecret) {
      throw new OAuthError("invalid_client", "Public clients must not send client_secret", 400);
    }
  }

  return app;
}

// ─── Token Issuance ───

export interface IssueTokenParams {
  clientId: string;
  userId: string | null;
  scopes: OAuthScope[];
  skipRefreshToken?: boolean;
  parentRefreshTokenHash?: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  tokenType: "Bearer";
  expiresIn: number;
  scope: string;
}

export async function issueTokenPair(params: IssueTokenParams): Promise<TokenResponse> {
  const accessTokenTtlMs = (getSetting("oauth.accessTokenTtlMs") as number) || 3600000;
  const refreshTokenTtlMs = (getSetting("oauth.refreshTokenTtlMs") as number) || 2592000000;

  const now = new Date();
  const accessToken = generateOpaqueToken();
  const accessTokenHash = hashToken(accessToken);

  await insertOAuthToken({
    tokenHash: accessTokenHash,
    type: "access",
    clientId: params.clientId,
    userId: params.userId,
    scopes: params.scopes,
    expiresAt: new Date(now.getTime() + accessTokenTtlMs),
    createdAt: now,
    revokedAt: null,
    parentTokenHash: null,
  });

  const result: TokenResponse = {
    accessToken,
    tokenType: "Bearer",
    expiresIn: Math.floor(accessTokenTtlMs / 1000),
    scope: params.scopes.join(" "),
  };

  if (!params.skipRefreshToken) {
    const refreshToken = generateOpaqueToken();
    const refreshTokenHash = hashToken(refreshToken);

    await insertOAuthToken({
      tokenHash: refreshTokenHash,
      type: "refresh",
      clientId: params.clientId,
      userId: params.userId,
      scopes: params.scopes,
      expiresAt: new Date(now.getTime() + refreshTokenTtlMs),
      createdAt: now,
      revokedAt: null,
      parentTokenHash: params.parentRefreshTokenHash ?? null,
    });

    result.refreshToken = refreshToken;
  }

  return result;
}

// ─── Token Validation ───

export async function validateBearerToken(
  authorization: string | undefined,
  requiredScopes: OAuthScope[],
): Promise<{ userId: string | null; scopes: OAuthScope[]; clientId: string }> {
  if (!authorization?.startsWith("Bearer ")) {
    throw new OAuthError("invalid_token", "Missing or invalid bearer token", 401);
  }

  const token = authorization.slice(7);
  const tokenDoc = await findOAuthTokenByHash(hashToken(token));

  if (!tokenDoc || tokenDoc.type !== "access") {
    throw new OAuthError("invalid_token", "Invalid or expired token", 401);
  }

  if (tokenDoc.expiresAt < new Date()) {
    throw new OAuthError("invalid_token", "Token expired", 401);
  }

  for (const scope of requiredScopes) {
    if (!tokenDoc.scopes.includes(scope)) {
      throw new OAuthError("insufficient_scope", `Missing scope: ${scope}`, 403);
    }
  }

  return {
    userId: tokenDoc.userId,
    scopes: tokenDoc.scopes as OAuthScope[],
    clientId: tokenDoc.clientId,
  };
}

// ─── Refresh Token Rotation ───

export async function refreshAccessToken(
  refreshTokenRaw: string,
  clientId: string,
): Promise<TokenResponse> {
  const refreshTokenHash = hashToken(refreshTokenRaw);

  const tokenDoc = await findOAuthTokenByHashIncludingRevoked(refreshTokenHash);

  if (!tokenDoc || tokenDoc.type !== "refresh") {
    throw new OAuthError("invalid_grant", "Invalid refresh token", 400);
  }

  if (tokenDoc.clientId !== clientId) {
    throw new OAuthError("invalid_grant", "Token does not belong to this client", 400);
  }

  // Replay attack: revoked refresh token reused
  if (tokenDoc.revokedAt) {
    if (tokenDoc.userId) {
      await revokeAllOAuthTokensForUserAndClient(clientId, tokenDoc.userId);
    }
    throw new OAuthError("invalid_grant", "Refresh token has been revoked", 400);
  }

  if (tokenDoc.expiresAt < new Date()) {
    throw new OAuthError("invalid_grant", "Refresh token expired", 400);
  }

  // Revoke old refresh token
  await revokeOAuthToken(refreshTokenHash);

  // Issue new token pair
  return issueTokenPair({
    clientId: tokenDoc.clientId,
    userId: tokenDoc.userId,
    scopes: tokenDoc.scopes as OAuthScope[],
    parentRefreshTokenHash: refreshTokenHash,
  });
}
