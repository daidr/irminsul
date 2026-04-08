import { createHash } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Stub Nitro auto-imports ───

const mockRedisSend = vi.fn();
vi.stubGlobal("getRedisClient", () => ({ send: mockRedisSend }));
vi.stubGlobal("buildRedisKey", (...args: string[]) => `irmin:${args.join(":")}`);
vi.stubGlobal("getSetting", vi.fn());
vi.stubGlobal("findOAuthAppByClientId", vi.fn());
vi.stubGlobal("findOAuthTokenByHash", vi.fn());
vi.stubGlobal("findOAuthTokenByHashIncludingRevoked", vi.fn());
vi.stubGlobal("insertOAuthToken", vi.fn());
vi.stubGlobal("revokeOAuthToken", vi.fn());
vi.stubGlobal("revokeAllOAuthTokensForUserAndClient", vi.fn());
vi.stubGlobal("Bun", { password: { hash: vi.fn(), verify: vi.fn() } });

let service: typeof import("../../server/utils/oauth-provider.service");

const mockGetSetting = globalThis.getSetting as ReturnType<typeof vi.fn>;
const mockFindOAuthAppByClientId = globalThis.findOAuthAppByClientId as ReturnType<typeof vi.fn>;
const mockFindOAuthTokenByHash = globalThis.findOAuthTokenByHash as ReturnType<typeof vi.fn>;
const mockFindOAuthTokenByHashIncludingRevoked = globalThis.findOAuthTokenByHashIncludingRevoked as ReturnType<typeof vi.fn>;
const mockInsertOAuthToken = globalThis.insertOAuthToken as ReturnType<typeof vi.fn>;
const mockRevokeOAuthToken = globalThis.revokeOAuthToken as ReturnType<typeof vi.fn>;
const mockRevokeAllOAuthTokensForUserAndClient = globalThis.revokeAllOAuthTokensForUserAndClient as ReturnType<typeof vi.fn>;
const mockBunPasswordVerify = (globalThis.Bun as any).password.verify as ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.clearAllMocks();
  service = await import("../../server/utils/oauth-provider.service");
});

// ─── Generators ───

describe("generateClientId", () => {
  it("returns a 32-character hex string", () => {
    const id = service.generateClientId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("generates unique values", () => {
    const a = service.generateClientId();
    const b = service.generateClientId();
    expect(a).not.toBe(b);
  });
});

describe("generateClientSecret", () => {
  it("returns a 48-character base64url string", () => {
    const secret = service.generateClientSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{48}$/);
  });
});

describe("generateOpaqueToken", () => {
  it("returns a base64url string of at least 40 characters", () => {
    const token = service.generateOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(40);
  });
});

describe("hashToken", () => {
  it("matches Node crypto SHA-256 hex digest", () => {
    const input = "test-token-value";
    const expected = createHash("sha256").update(input).digest("hex");
    expect(service.hashToken(input)).toBe(expected);
  });

  it("produces different hashes for different inputs", () => {
    expect(service.hashToken("a")).not.toBe(service.hashToken("b"));
  });
});

// ─── PKCE ───

describe("verifyPkce", () => {
  it("returns true for valid code_verifier and code_challenge pair", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(service.verifyPkce(verifier, challenge)).toBe(true);
  });

  it("returns false for mismatched verifier", () => {
    const challenge = createHash("sha256").update("correct-verifier").digest("base64url");
    expect(service.verifyPkce("wrong-verifier", challenge)).toBe(false);
  });
});

// ─── Authorization Code (Redis) ───

describe("storeAuthorizationCode", () => {
  it("stores code data in Redis with hashed key and TTL", async () => {
    mockGetSetting.mockReturnValue(120);
    mockRedisSend.mockResolvedValue("OK");

    const data = {
      clientId: "c1",
      userId: "u1",
      scopes: ["profile:read"] as any,
      redirectUri: "https://example.com/cb",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256" as const,
      createdAt: Date.now(),
    };

    await service.storeAuthorizationCode("raw-code", data);

    expect(mockRedisSend).toHaveBeenCalledOnce();
    const [cmd, args] = mockRedisSend.mock.calls[0];
    expect(cmd).toBe("SET");
    const expectedKey = `irmin:oauth:code:${service.hashToken("raw-code")}`;
    expect(args[0]).toBe(expectedKey);
    expect(JSON.parse(args[1])).toEqual(data);
    expect(args[2]).toBe("EX");
    expect(args[3]).toBe("120");
  });

  it("defaults to 60s TTL when setting is not configured", async () => {
    mockGetSetting.mockReturnValue(undefined);
    mockRedisSend.mockResolvedValue("OK");

    await service.storeAuthorizationCode("code", {
      clientId: "c1",
      userId: "u1",
      scopes: [],
      redirectUri: "https://example.com/cb",
      codeChallenge: "ch",
      codeChallengeMethod: "S256",
      createdAt: Date.now(),
    });

    const args = mockRedisSend.mock.calls[0][1];
    expect(args[3]).toBe("60");
  });
});

describe("consumeAuthorizationCode", () => {
  it("retrieves and deletes code data from Redis", async () => {
    const data = { clientId: "c1", userId: "u1", scopes: ["profile:read"] };
    mockRedisSend.mockResolvedValue(JSON.stringify(data));

    const result = await service.consumeAuthorizationCode("raw-code");

    expect(result).toEqual(data);
    const expectedKey = `irmin:oauth:code:${service.hashToken("raw-code")}`;
    expect(mockRedisSend).toHaveBeenCalledWith("GETDEL", [expectedKey]);
  });

  it("returns null when code is expired or missing", async () => {
    mockRedisSend.mockResolvedValue(null);
    const result = await service.consumeAuthorizationCode("expired-code");
    expect(result).toBeNull();
  });
});

// ─── Client Authentication ───

describe("authenticateClient", () => {
  const makeApp = (overrides: Record<string, unknown> = {}) => ({
    clientId: "c1",
    clientSecretHash: "$argon2id$hash",
    type: "confidential",
    name: "Test App",
    approved: true,
    ...overrides,
  });

  it("throws for unknown client", async () => {
    mockFindOAuthAppByClientId.mockResolvedValue(null);
    await expect(service.authenticateClient("unknown", "secret")).rejects.toMatchObject({
      errorCode: "invalid_client",
      statusCode: 401,
    });
  });

  it("throws for unapproved client", async () => {
    mockFindOAuthAppByClientId.mockResolvedValue(makeApp({ approved: false }));
    await expect(service.authenticateClient("c1", "secret")).rejects.toMatchObject({
      errorCode: "invalid_client",
      errorDescription: "Client not approved",
    });
  });

  it("authenticates confidential client with valid secret", async () => {
    const app = makeApp();
    mockFindOAuthAppByClientId.mockResolvedValue(app);
    mockBunPasswordVerify.mockResolvedValue(true);

    const result = await service.authenticateClient("c1", "correct-secret");
    expect(result).toEqual(app);
    expect(mockBunPasswordVerify).toHaveBeenCalledWith("correct-secret", "$argon2id$hash");
  });

  it("throws for confidential client without secret", async () => {
    mockFindOAuthAppByClientId.mockResolvedValue(makeApp());
    await expect(service.authenticateClient("c1", undefined)).rejects.toMatchObject({
      errorCode: "invalid_client",
      errorDescription: "Client secret required",
    });
  });

  it("throws for confidential client with invalid secret", async () => {
    mockFindOAuthAppByClientId.mockResolvedValue(makeApp());
    mockBunPasswordVerify.mockResolvedValue(false);
    await expect(service.authenticateClient("c1", "wrong")).rejects.toMatchObject({
      errorCode: "invalid_client",
      errorDescription: "Invalid client secret",
    });
  });

  it("authenticates public client without secret", async () => {
    const app = makeApp({ type: "public", clientSecretHash: null });
    mockFindOAuthAppByClientId.mockResolvedValue(app);

    const result = await service.authenticateClient("c1", undefined);
    expect(result).toEqual(app);
    expect(mockBunPasswordVerify).not.toHaveBeenCalled();
  });

  it("throws when public client sends a secret", async () => {
    mockFindOAuthAppByClientId.mockResolvedValue(makeApp({ type: "public", clientSecretHash: null }));
    await expect(service.authenticateClient("c1", "secret")).rejects.toMatchObject({
      errorCode: "invalid_client",
      errorDescription: "Public clients must not send client_secret",
      statusCode: 400,
    });
  });
});

// ─── Token Issuance ───

describe("issueTokenPair", () => {
  beforeEach(() => {
    mockGetSetting.mockReturnValue(undefined);
    mockInsertOAuthToken.mockResolvedValue(undefined);
  });

  it("issues access + refresh token pair", async () => {
    const result = await service.issueTokenPair({
      clientId: "c1",
      userId: "u1",
      scopes: ["profile:read"],
    });

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.tokenType).toBe("Bearer");
    expect(result.expiresIn).toBe(3600); // default 3600000ms / 1000
    expect(result.scope).toBe("profile:read");

    // Two insertOAuthToken calls: access + refresh
    expect(mockInsertOAuthToken).toHaveBeenCalledTimes(2);

    const accessCall = mockInsertOAuthToken.mock.calls[0][0];
    expect(accessCall.type).toBe("access");
    expect(accessCall.clientId).toBe("c1");
    expect(accessCall.userId).toBe("u1");
    expect(accessCall.scopes).toEqual(["profile:read"]);
    expect(accessCall.revokedAt).toBeNull();

    const refreshCall = mockInsertOAuthToken.mock.calls[1][0];
    expect(refreshCall.type).toBe("refresh");
    expect(refreshCall.parentTokenHash).toBeNull();
  });

  it("skips refresh token when skipRefreshToken is true", async () => {
    const result = await service.issueTokenPair({
      clientId: "c1",
      userId: null,
      scopes: ["profile:read"],
      skipRefreshToken: true,
    });

    expect(result.refreshToken).toBeUndefined();
    expect(mockInsertOAuthToken).toHaveBeenCalledTimes(1);
  });

  it("sets parentTokenHash on refresh token when provided", async () => {
    await service.issueTokenPair({
      clientId: "c1",
      userId: "u1",
      scopes: ["profile:read"],
      parentRefreshTokenHash: "parent-hash",
    });

    const refreshCall = mockInsertOAuthToken.mock.calls[1][0];
    expect(refreshCall.parentTokenHash).toBe("parent-hash");
  });

  it("uses custom TTL from settings", async () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === "oauth.accessTokenTtlMs") return 7200000;
      if (key === "oauth.refreshTokenTtlMs") return 86400000;
      return undefined;
    });

    const result = await service.issueTokenPair({
      clientId: "c1",
      userId: "u1",
      scopes: ["profile:read"],
    });

    expect(result.expiresIn).toBe(7200);
  });
});

// ─── Token Validation ───

describe("validateBearerToken", () => {
  it("throws for missing authorization header", async () => {
    await expect(service.validateBearerToken(undefined, [])).rejects.toMatchObject({
      errorCode: "invalid_token",
      statusCode: 401,
    });
  });

  it("throws for non-Bearer authorization", async () => {
    await expect(service.validateBearerToken("Basic abc", [])).rejects.toMatchObject({
      errorCode: "invalid_token",
    });
  });

  it("throws for invalid/unknown token", async () => {
    mockFindOAuthTokenByHash.mockResolvedValue(null);
    await expect(service.validateBearerToken("Bearer some-token", [])).rejects.toMatchObject({
      errorCode: "invalid_token",
    });
  });

  it("throws for expired token", async () => {
    mockFindOAuthTokenByHash.mockResolvedValue({
      type: "access",
      expiresAt: new Date(Date.now() - 1000),
      scopes: ["profile:read"],
      clientId: "c1",
      userId: "u1",
    });
    await expect(service.validateBearerToken("Bearer tok", ["profile:read"])).rejects.toMatchObject({
      errorCode: "invalid_token",
      errorDescription: "Token expired",
    });
  });

  it("throws for insufficient scope", async () => {
    mockFindOAuthTokenByHash.mockResolvedValue({
      type: "access",
      expiresAt: new Date(Date.now() + 60000),
      scopes: ["profile:read"],
      clientId: "c1",
      userId: "u1",
    });
    await expect(service.validateBearerToken("Bearer tok", ["email:read"])).rejects.toMatchObject({
      errorCode: "insufficient_scope",
      statusCode: 403,
    });
  });

  it("returns token info for valid token with sufficient scopes", async () => {
    mockFindOAuthTokenByHash.mockResolvedValue({
      type: "access",
      expiresAt: new Date(Date.now() + 60000),
      scopes: ["profile:read", "email:read"],
      clientId: "c1",
      userId: "u1",
    });

    const result = await service.validateBearerToken("Bearer valid-token", ["profile:read"]);
    expect(result).toEqual({
      userId: "u1",
      scopes: ["profile:read", "email:read"],
      clientId: "c1",
    });
  });
});

// ─── Refresh Token Rotation ───

describe("refreshAccessToken", () => {
  const makeRefreshTokenDoc = (overrides: Record<string, unknown> = {}) => ({
    tokenHash: service.hashToken("refresh-raw"),
    type: "refresh",
    clientId: "c1",
    userId: "u1",
    scopes: ["profile:read"],
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
    revokedAt: null,
    parentTokenHash: null,
    ...overrides,
  });

  beforeEach(() => {
    mockGetSetting.mockReturnValue(undefined);
    mockInsertOAuthToken.mockResolvedValue(undefined);
    mockRevokeOAuthToken.mockResolvedValue(undefined);
    mockRevokeAllOAuthTokensForUserAndClient.mockResolvedValue(undefined);
  });

  it("throws for invalid refresh token", async () => {
    mockFindOAuthTokenByHashIncludingRevoked.mockResolvedValue(null);
    await expect(service.refreshAccessToken("bad-token", "c1")).rejects.toMatchObject({
      errorCode: "invalid_grant",
    });
  });

  it("throws when token does not belong to client", async () => {
    mockFindOAuthTokenByHashIncludingRevoked.mockResolvedValue(makeRefreshTokenDoc({ clientId: "other" }));
    await expect(service.refreshAccessToken("refresh-raw", "c1")).rejects.toMatchObject({
      errorCode: "invalid_grant",
      errorDescription: "Token does not belong to this client",
    });
  });

  it("detects replay attack and revokes all tokens for user+client", async () => {
    mockFindOAuthTokenByHashIncludingRevoked.mockResolvedValue(
      makeRefreshTokenDoc({ revokedAt: new Date() }),
    );

    await expect(service.refreshAccessToken("refresh-raw", "c1")).rejects.toMatchObject({
      errorCode: "invalid_grant",
      errorDescription: "Refresh token has been revoked",
    });

    expect(mockRevokeAllOAuthTokensForUserAndClient).toHaveBeenCalledWith("c1", "u1");
  });

  it("does not revoke all when replay has no userId", async () => {
    mockFindOAuthTokenByHashIncludingRevoked.mockResolvedValue(
      makeRefreshTokenDoc({ revokedAt: new Date(), userId: null }),
    );

    await expect(service.refreshAccessToken("refresh-raw", "c1")).rejects.toMatchObject({
      errorCode: "invalid_grant",
    });

    expect(mockRevokeAllOAuthTokensForUserAndClient).not.toHaveBeenCalled();
  });

  it("throws for expired refresh token", async () => {
    mockFindOAuthTokenByHashIncludingRevoked.mockResolvedValue(
      makeRefreshTokenDoc({ expiresAt: new Date(Date.now() - 1000) }),
    );

    await expect(service.refreshAccessToken("refresh-raw", "c1")).rejects.toMatchObject({
      errorCode: "invalid_grant",
      errorDescription: "Refresh token expired",
    });
  });

  it("rotates refresh token: revokes old, issues new pair", async () => {
    const oldDoc = makeRefreshTokenDoc();
    mockFindOAuthTokenByHashIncludingRevoked.mockResolvedValue(oldDoc);

    const result = await service.refreshAccessToken("refresh-raw", "c1");

    // Old token revoked
    expect(mockRevokeOAuthToken).toHaveBeenCalledWith(service.hashToken("refresh-raw"));

    // New pair issued
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.tokenType).toBe("Bearer");
    expect(result.scope).toBe("profile:read");

    // Two inserts: access + refresh
    expect(mockInsertOAuthToken).toHaveBeenCalledTimes(2);

    // New refresh token's parentTokenHash should be the old hash
    const refreshCall = mockInsertOAuthToken.mock.calls[1][0];
    expect(refreshCall.parentTokenHash).toBe(service.hashToken("refresh-raw"));
  });
});

// ─── OAuthError ───

describe("OAuthError", () => {
  it("has correct properties", () => {
    const err = new service.OAuthError("invalid_grant", "Bad grant", 400);
    expect(err.errorCode).toBe("invalid_grant");
    expect(err.errorDescription).toBe("Bad grant");
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe("Bad grant");
    expect(err).toBeInstanceOf(Error);
  });

  it("defaults statusCode to 400", () => {
    const err = new service.OAuthError("error", "desc");
    expect(err.statusCode).toBe(400);
  });
});
