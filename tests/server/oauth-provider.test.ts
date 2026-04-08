import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

// --- Mock Nitro auto-imports ---
vi.stubGlobal("defineEventHandler", (handler: Function) => handler);
vi.stubGlobal("readBody", vi.fn());
vi.stubGlobal("setResponseHeader", vi.fn());
vi.stubGlobal("setResponseStatus", vi.fn());
vi.stubGlobal("getHeader", vi.fn());
vi.stubGlobal("createError", (opts: any) => {
  const err = new Error(opts.statusMessage);
  (err as any).statusCode = opts.statusCode;
  return err;
});

// Mock Bun.password (before service import since authenticateClient uses it)
vi.stubGlobal("Bun", {
  password: {
    hash: vi.fn().mockResolvedValue("hashed"),
    verify: vi.fn().mockResolvedValue(true),
  },
});

// Mock settings
vi.stubGlobal("getSetting", (key: string) => {
  const s: Record<string, unknown> = {
    "oauth.enabled": true,
    "oauth.accessTokenTtlMs": 3600000,
    "oauth.refreshTokenTtlMs": 2592000000,
    "oauth.authorizationCodeTtlS": 60,
  };
  return s[key];
});

// Mock Redis
const mockRedis = { send: vi.fn() };
vi.stubGlobal("getRedisClient", () => mockRedis);
vi.stubGlobal("buildRedisKey", (...args: string[]) => `irmin:${args.join(":")}`);

// Mock repositories
vi.stubGlobal("findOAuthAppByClientId", vi.fn());
vi.stubGlobal("findOAuthTokenByHash", vi.fn());
vi.stubGlobal("findOAuthTokenByHashIncludingRevoked", vi.fn());
vi.stubGlobal("insertOAuthToken", vi.fn());
vi.stubGlobal("revokeOAuthToken", vi.fn());
vi.stubGlobal("revokeAllOAuthTokensForUserAndClient", vi.fn());

// Fix zod v4 named export
vi.mock("zod", async (importOriginal) => {
  const mod = await importOriginal<typeof import("zod")>();
  return { ...mod, z: mod };
});

// Mock evlog
vi.mock("evlog", async (importOriginal) => {
  const mod = await importOriginal<typeof import("evlog")>();
  return {
    ...mod,
    useLogger: () => ({ set: vi.fn(), error: vi.fn(), emit: vi.fn() }),
    createLogger: () => ({ set: vi.fn(), error: vi.fn(), emit: vi.fn() }),
  };
});

// Import actual service functions and expose as globals (Nitro auto-import simulation)
import {
  OAuthError,
  authenticateClient,
  consumeAuthorizationCode,
  verifyPkce,
  issueTokenPair,
  refreshAccessToken,
  hashToken,
  generateOpaqueToken,
} from "../../server/utils/oauth-provider.service";

vi.stubGlobal("OAuthError", OAuthError);
vi.stubGlobal("authenticateClient", authenticateClient);
vi.stubGlobal("consumeAuthorizationCode", consumeAuthorizationCode);
vi.stubGlobal("verifyPkce", verifyPkce);
vi.stubGlobal("issueTokenPair", issueTokenPair);
vi.stubGlobal("refreshAccessToken", refreshAccessToken);
vi.stubGlobal("hashToken", hashToken);
vi.stubGlobal("generateOpaqueToken", generateOpaqueToken);

// --- Helpers ---

function createFakeEvent() {
  return { context: {}, headers: new Map() };
}

function makePkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

const mockApp = {
  _id: "app-id",
  clientId: "test-client-id",
  clientSecretHash: "hashed-secret",
  type: "confidential" as const,
  name: "Test App",
  description: "A test app",
  icon: null,
  redirectUris: ["https://example.com/callback"],
  scopes: ["profile:read", "email:read"],
  ownerId: "owner-1",
  approved: true,
  approvedBy: "admin",
  approvedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const publicApp = {
  ...mockApp,
  type: "public" as const,
  clientSecretHash: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as any).insertOAuthToken.mockResolvedValue(undefined);
  (globalThis as any).revokeOAuthToken.mockResolvedValue(undefined);
  (globalThis as any).revokeAllOAuthTokensForUserAndClient.mockResolvedValue(undefined);
  mockRedis.send.mockResolvedValue(null);
  // Re-set Bun.password mock after clearAllMocks
  (globalThis as any).Bun.password.verify.mockResolvedValue(true);
  (globalThis as any).Bun.password.hash.mockResolvedValue("hashed");
});

describe("OAuth token endpoint", () => {
  let handler: Function;

  beforeEach(async () => {
    handler = (await import("../../server/api/oauth-provider/token.post")).default;
  });

  // --- authorization_code grant ---

  describe("authorization_code grant", () => {
    const codeVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const codeChallenge = makePkceChallenge(codeVerifier);

    const codeData = {
      clientId: "test-client-id",
      userId: "user-123",
      scopes: ["profile:read"],
      redirectUri: "https://example.com/callback",
      codeChallenge,
      codeChallengeMethod: "S256",
      createdAt: Date.now(),
    };

    it("valid code + PKCE returns access_token + refresh_token", async () => {
      (globalThis as any).readBody.mockResolvedValue({
        grant_type: "authorization_code",
        client_id: "test-client-id",
        client_secret: "the-secret",
        code: "auth-code-123",
        redirect_uri: "https://example.com/callback",
        code_verifier: codeVerifier,
      });
      (globalThis as any).findOAuthAppByClientId.mockResolvedValue(mockApp);
      mockRedis.send.mockResolvedValue(JSON.stringify(codeData));

      const event = createFakeEvent();
      const result = await handler(event);

      expect(result).toHaveProperty("access_token");
      expect(result).toHaveProperty("refresh_token");
      expect(result.token_type).toBe("Bearer");
      expect(result.expires_in).toBe(3600);
      expect(result.scope).toBe("profile:read");
      expect((globalThis as any).insertOAuthToken).toHaveBeenCalledTimes(2);
    });

    it("expired/invalid code returns invalid_grant", async () => {
      (globalThis as any).readBody.mockResolvedValue({
        grant_type: "authorization_code",
        client_id: "test-client-id",
        client_secret: "the-secret",
        code: "bad-code",
        redirect_uri: "https://example.com/callback",
        code_verifier: codeVerifier,
      });
      (globalThis as any).findOAuthAppByClientId.mockResolvedValue(mockApp);
      mockRedis.send.mockResolvedValue(null);

      const event = createFakeEvent();
      const result = await handler(event);

      expect((globalThis as any).setResponseStatus).toHaveBeenCalledWith(event, 400);
      expect(result.error).toBe("invalid_grant");
    });

    it("wrong redirect_uri returns invalid_grant", async () => {
      (globalThis as any).readBody.mockResolvedValue({
        grant_type: "authorization_code",
        client_id: "test-client-id",
        client_secret: "the-secret",
        code: "auth-code-123",
        redirect_uri: "https://evil.com/callback",
        code_verifier: codeVerifier,
      });
      (globalThis as any).findOAuthAppByClientId.mockResolvedValue(mockApp);
      mockRedis.send.mockResolvedValue(JSON.stringify(codeData));

      const event = createFakeEvent();
      const result = await handler(event);

      expect((globalThis as any).setResponseStatus).toHaveBeenCalledWith(event, 400);
      expect(result.error).toBe("invalid_grant");
      expect(result.error_description).toContain("redirect_uri");
    });

    it("invalid PKCE verifier returns invalid_grant", async () => {
      (globalThis as any).readBody.mockResolvedValue({
        grant_type: "authorization_code",
        client_id: "test-client-id",
        client_secret: "the-secret",
        code: "auth-code-123",
        redirect_uri: "https://example.com/callback",
        code_verifier: "wrong-verifier",
      });
      (globalThis as any).findOAuthAppByClientId.mockResolvedValue(mockApp);
      mockRedis.send.mockResolvedValue(JSON.stringify(codeData));

      const event = createFakeEvent();
      const result = await handler(event);

      expect((globalThis as any).setResponseStatus).toHaveBeenCalledWith(event, 400);
      expect(result.error).toBe("invalid_grant");
      expect(result.error_description).toContain("PKCE");
    });
  });

  // --- client_credentials grant ---

  describe("client_credentials grant", () => {
    it("valid confidential client with profile:read returns access_token only", async () => {
      (globalThis as any).readBody.mockResolvedValue({
        grant_type: "client_credentials",
        client_id: "test-client-id",
        client_secret: "the-secret",
        scope: "profile:read",
      });
      (globalThis as any).findOAuthAppByClientId.mockResolvedValue(mockApp);

      const event = createFakeEvent();
      const result = await handler(event);

      expect(result).toHaveProperty("access_token");
      expect(result).not.toHaveProperty("refresh_token");
      expect(result.token_type).toBe("Bearer");
      expect(result.scope).toBe("profile:read");
      expect((globalThis as any).insertOAuthToken).toHaveBeenCalledTimes(1);
    });

    it("non-allowed scope (email:read) returns invalid_scope", async () => {
      (globalThis as any).readBody.mockResolvedValue({
        grant_type: "client_credentials",
        client_id: "test-client-id",
        client_secret: "the-secret",
        scope: "email:read",
      });
      (globalThis as any).findOAuthAppByClientId.mockResolvedValue(mockApp);

      const event = createFakeEvent();
      const result = await handler(event);

      expect((globalThis as any).setResponseStatus).toHaveBeenCalledWith(event, 400);
      expect(result.error).toBe("invalid_scope");
    });

    it("public client without secret returns invalid_request", async () => {
      (globalThis as any).readBody.mockResolvedValue({
        grant_type: "client_credentials",
        client_id: "test-client-id",
        scope: "profile:read",
      });
      (globalThis as any).findOAuthAppByClientId.mockResolvedValue(publicApp);

      const event = createFakeEvent();
      const result = await handler(event);

      expect((globalThis as any).setResponseStatus).toHaveBeenCalledWith(event, 400);
      expect(result.error).toBe("invalid_request");
    });

    it("public client with secret returns invalid_client", async () => {
      (globalThis as any).readBody.mockResolvedValue({
        grant_type: "client_credentials",
        client_id: "test-client-id",
        client_secret: "the-secret",
        scope: "profile:read",
      });
      (globalThis as any).findOAuthAppByClientId.mockResolvedValue(publicApp);

      const event = createFakeEvent();
      const result = await handler(event);

      expect((globalThis as any).setResponseStatus).toHaveBeenCalledWith(event, 400);
      expect(result.error).toBe("invalid_client");
    });
  });

  // --- refresh_token grant ---

  describe("refresh_token grant", () => {
    it("valid refresh token returns new access_token + new refresh_token", async () => {
      const refreshTokenRaw = "some-refresh-token";
      const refreshTokenHash = createHash("sha256").update(refreshTokenRaw).digest("hex");

      (globalThis as any).readBody.mockResolvedValue({
        grant_type: "refresh_token",
        client_id: "test-client-id",
        client_secret: "the-secret",
        refresh_token: refreshTokenRaw,
      });
      (globalThis as any).findOAuthAppByClientId.mockResolvedValue(mockApp);
      (globalThis as any).findOAuthTokenByHashIncludingRevoked.mockResolvedValue({
        tokenHash: refreshTokenHash,
        type: "refresh",
        clientId: "test-client-id",
        userId: "user-123",
        scopes: ["profile:read"],
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date(),
        revokedAt: null,
        parentTokenHash: null,
      });

      const event = createFakeEvent();
      const result = await handler(event);

      expect(result).toHaveProperty("access_token");
      expect(result).toHaveProperty("refresh_token");
      expect(result.token_type).toBe("Bearer");
      expect((globalThis as any).revokeOAuthToken).toHaveBeenCalledWith(refreshTokenHash);
      expect((globalThis as any).insertOAuthToken).toHaveBeenCalledTimes(2);
    });
  });

  // --- Error handling ---

  describe("error handling", () => {
    it("unknown grant_type returns unsupported_grant_type", async () => {
      (globalThis as any).readBody.mockResolvedValue({
        grant_type: "magic_token",
      });

      const event = createFakeEvent();
      const result = await handler(event);

      expect((globalThis as any).setResponseStatus).toHaveBeenCalledWith(event, 400);
      expect(result.error).toBe("unsupported_grant_type");
    });

    it("missing grant_type returns unsupported_grant_type", async () => {
      (globalThis as any).readBody.mockResolvedValue({});

      const event = createFakeEvent();
      const result = await handler(event);

      expect((globalThis as any).setResponseStatus).toHaveBeenCalledWith(event, 400);
      expect(result.error).toBe("unsupported_grant_type");
    });
  });
});
